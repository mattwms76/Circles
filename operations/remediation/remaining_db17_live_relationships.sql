-- DB-17 — proposed live scalar-reference integrity contract (INACTIVE / UNAPPLIED).
--
-- This is deliberately a psql/autocommit operational candidate, not an applied migration.
-- It cannot run unless an authorized operator has both recorded the exact lifecycle adoption
-- below and supplied both gates in the same psql session:
--
--   PGOPTIONS='-c circles.db17_live_relationships_contract=DB17_LIVE_RELATIONSHIPS_ADOPTED_V1' \
--   psql -X -v ON_ERROR_STOP=1 -v db17_live_relationships_adopted_v1=1 \
--     -f operations/remediation/remaining_db17_live_relationships.sql
--
-- The required lifecycle decision is exactly:
--   * retain/tombstone historical user/stream/viewer/chat evidence; do not physically
--     delete a referenced user or stream while RESTRICT evidence exists;
--   * detach a retained stream from a physically deleted Circle;
--   * cascade only transient host-lease and live-signal state.
--
-- The parent remains responsible for obtaining that decision, confirming the source-file
-- checksum and maintenance window, running a fresh aggregate-only preflight, and executing
-- this candidate. Do not use --single-transaction or a transaction-wrapping migration
-- runner: the five new child indexes use CREATE INDEX CONCURRENTLY.
--
-- Successful closure creates only the five missing child indexes and seven named foreign
-- keys. Every new FK is validated before the script can report success; NOT VALID is only
-- the short installation state that avoids combining the initial table lock with historical
-- validation. The candidate does not alter rows, roles, grants, RLS, policies, routines,
-- schedules, existing pin constraints, or unrelated relationship actions.

\set ON_ERROR_STOP on
\if :{?db17_live_relationships_adopted_v1}
\else
  \echo 'DB-17 refused: provide -v db17_live_relationships_adopted_v1=1 only after the exact lifecycle decision is recorded.'
  DO $db17_missing_acknowledgement$
  BEGIN
    RAISE EXCEPTION 'DB-17 refused: db17_live_relationships_adopted_v1 acknowledgement is required';
  END;
  $db17_missing_acknowledgement$;
\endif
\if :db17_live_relationships_adopted_v1
\else
  \echo 'DB-17 refused: db17_live_relationships_adopted_v1 must be a true psql boolean (use 1).'
  DO $db17_invalid_acknowledgement$
  BEGIN
    RAISE EXCEPTION 'DB-17 refused: db17_live_relationships_adopted_v1 must be true';
  END;
  $db17_invalid_acknowledgement$;
\endif

SET lock_timeout = '5s';
SET statement_timeout = '10min';

DO $db17_live_lock$
BEGIN
  IF NOT pg_catalog.pg_try_advisory_lock(
    pg_catalog.hashtextextended('circles.db17.live_relationships.v1', 0)
  ) THEN
    RAISE EXCEPTION 'DB-17 live relationships are already running in another session; stop instead of overlapping maintenance';
  END IF;
END;
$db17_live_lock$;

-- Session-local helpers deliberately leave no routine in a private schema.
CREATE OR REPLACE FUNCTION pg_temp.db17_assert_gate()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $db17_gate$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'DB-17 live relationships must run as postgres, got %', current_user;
  END IF;

  IF current_setting('circles.db17_live_relationships_contract', true)
       IS DISTINCT FROM 'DB17_LIVE_RELATIONSHIPS_ADOPTED_V1' THEN
    RAISE EXCEPTION
      'DB-17 live relationships require the exact session contract DB17_LIVE_RELATIONSHIPS_ADOPTED_V1; lifecycle policy remains inactive';
  END IF;
END;
$db17_gate$;

CREATE OR REPLACE FUNCTION pg_temp.db17_assert_child_index(
  p_table pg_catalog.name,
  p_index pg_catalog.name,
  p_columns pg_catalog.name[],
  p_is_unique boolean,
  p_is_primary boolean,
  p_must_exist boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $db17_index$
DECLARE
  v_table pg_catalog.oid := pg_catalog.to_regclass(pg_catalog.format('circles_app.%I', p_table));
  v_index pg_catalog.oid := pg_catalog.to_regclass(pg_catalog.format('circles_app.%I', p_index));
  v_columns pg_catalog.name[];
BEGIN
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'DB-17 required child table circles_app.% is missing', p_table;
  END IF;

  IF v_index IS NULL THEN
    IF p_must_exist THEN
      RAISE EXCEPTION 'DB-17 postflight missing required child index circles_app.%', p_index;
    END IF;
    RETURN;
  END IF;

  SELECT pg_catalog.array_agg(attribute.attname ORDER BY key_column.ordinality)
    INTO v_columns
  FROM pg_catalog.pg_index AS index_metadata
  CROSS JOIN LATERAL pg_catalog.unnest(index_metadata.indkey)
    WITH ORDINALITY AS key_column(attnum, ordinality)
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = index_metadata.indrelid
   AND attribute.attnum = key_column.attnum
  WHERE index_metadata.indexrelid = v_index;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_metadata
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_metadata.indexrelid
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_relation.relam
    WHERE index_metadata.indexrelid = v_index
      AND index_metadata.indrelid = v_table
      AND access_method.amname = 'btree'
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND index_metadata.indislive
      AND index_metadata.indisunique = p_is_unique
      AND index_metadata.indisprimary = p_is_primary
      AND index_metadata.indpred IS NULL
      AND index_metadata.indexprs IS NULL
      AND index_metadata.indnkeyatts = pg_catalog.cardinality(p_columns)
      AND index_metadata.indnatts = pg_catalog.cardinality(p_columns)
  ) OR v_columns IS DISTINCT FROM p_columns THEN
    RAISE EXCEPTION
      'DB-17 index definition drift for circles_app.%: expected % on circles_app.% columns %',
      p_index, CASE WHEN p_is_primary THEN 'primary B-tree' WHEN p_is_unique THEN 'unique B-tree' ELSE 'plain B-tree' END,
      p_table, p_columns;
  END IF;
END;
$db17_index$;

CREATE OR REPLACE FUNCTION pg_temp.db17_assert_live_fk(
  p_child_table pg_catalog.name,
  p_child_column pg_catalog.name,
  p_parent_table pg_catalog.name,
  p_constraint pg_catalog.name,
  p_delete_action "char",
  p_must_exist boolean,
  p_must_be_valid boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $db17_fk$
DECLARE
  v_child pg_catalog.oid := pg_catalog.to_regclass(pg_catalog.format('circles_app.%I', p_child_table));
  v_parent pg_catalog.oid := pg_catalog.to_regclass(pg_catalog.format('circles_app.%I', p_parent_table));
  v_child_attnum smallint;
  v_parent_attnum smallint;
  v_constraint record;
BEGIN
  IF v_child IS NULL OR v_parent IS NULL THEN
    RAISE EXCEPTION 'DB-17 FK prerequisite missing for %.% -> %', p_child_table, p_child_column, p_parent_table;
  END IF;

  SELECT attnum INTO v_child_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = v_child
    AND attname = p_child_column
    AND attnum > 0
    AND NOT attisdropped;

  SELECT attnum INTO v_parent_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = v_parent
    AND attname = 'id'::pg_catalog.name
    AND attnum > 0
    AND NOT attisdropped;

  IF v_child_attnum IS NULL OR v_parent_attnum IS NULL THEN
    RAISE EXCEPTION 'DB-17 FK column prerequisite missing for %.% -> %.id', p_child_table, p_child_column, p_parent_table;
  END IF;

  SELECT constraint_catalog.*
    INTO v_constraint
  FROM pg_catalog.pg_constraint AS constraint_catalog
  WHERE constraint_catalog.conname = p_constraint;

  IF FOUND THEN
    IF v_constraint.contype <> 'f'
       OR v_constraint.conrelid <> v_child
       OR v_constraint.confrelid <> v_parent
       OR v_constraint.conkey <> ARRAY[v_child_attnum]
       OR v_constraint.confkey <> ARRAY[v_parent_attnum]
       OR v_constraint.confdeltype <> p_delete_action
       OR v_constraint.confupdtype <> 'a'
       OR v_constraint.confmatchtype <> 's'
       OR v_constraint.condeferrable
       OR v_constraint.condeferred
       OR (p_must_be_valid AND NOT v_constraint.convalidated) THEN
      RAISE EXCEPTION
        'DB-17 live FK definition drift for % (expected circles_app.%.% -> circles_app.% with reviewed delete action)',
        p_constraint, p_child_table, p_child_column, p_parent_table;
    END IF;
  ELSIF p_must_exist THEN
    RAISE EXCEPTION 'DB-17 postflight missing required FK %', p_constraint;
  END IF;

  -- Do not silently adopt a differently named pre-existing FK on the same scalar child field.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS other_constraint
    WHERE other_constraint.contype = 'f'
      AND other_constraint.conrelid = v_child
      AND other_constraint.conkey = ARRAY[v_child_attnum]
      AND other_constraint.conname <> p_constraint
  ) THEN
    RAISE EXCEPTION
      'DB-17 found an unexpected FK on circles_app.%.%; review relationship lifecycle compatibility',
      p_child_table, p_child_column;
  END IF;
END;
$db17_fk$;

CREATE OR REPLACE FUNCTION pg_temp.db17_assert_current_contract()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $db17_contract$
DECLARE
  v_table pg_catalog.name;
  v_column pg_catalog.name;
  v_not_null boolean;
  v_relation pg_catalog.oid;
  v_actual_not_null boolean;
  v_expected_policies pg_catalog.name[];
  v_actual_policies pg_catalog.name[];
BEGIN
  PERFORM pg_temp.db17_assert_gate();

  IF pg_catalog.to_regnamespace('circles_app') IS NULL
     OR (SELECT namespace_catalog.nspowner = 'postgres'::pg_catalog.regrole
         FROM pg_catalog.pg_namespace AS namespace_catalog
         WHERE namespace_catalog.oid = 'circles_app'::pg_catalog.regnamespace) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'DB-17 requires postgres-owned circles_app schema';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(ARRAY[
      'postgres'::pg_catalog.name,
      'anon'::pg_catalog.name,
      'authenticated'::pg_catalog.name,
      'service_role'::pg_catalog.name,
      'circles_app_login'::pg_catalog.name,
      'circles_app_runtime'::pg_catalog.name,
      'circles_admin_runtime'::pg_catalog.name,
      'circles_admin_native_executor'::pg_catalog.name
    ]) AS expected(role_name)
    WHERE pg_catalog.to_regrole(expected.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'DB-17 expected Circles roles are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname IN ('circles_app_login', 'circles_app_runtime')
      AND (role_catalog.rolcanlogin OR role_catalog.rolinherit OR role_catalog.rolsuper OR role_catalog.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'DB-17 requires detached NOLOGIN/NOINHERIT/NOBYPASSRLS application roles';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.roleid = 'circles_app_login'::pg_catalog.regrole
      AND membership.member <> 'postgres'::pg_catalog.regrole
  ) THEN
    RAISE EXCEPTION 'DB-17 found an unexpected circles_app_login membership; preserve detached login state';
  END IF;

  FOR v_table IN
    SELECT unnest(ARRAY[
      'users'::pg_catalog.name,
      'circles'::pg_catalog.name,
      'streams'::pg_catalog.name,
      'activeHostLeases'::pg_catalog.name,
      'liveViewers'::pg_catalog.name,
      'liveSignals'::pg_catalog.name,
      'liveChat'::pg_catalog.name
    ])
  LOOP
    v_relation := pg_catalog.to_regclass(pg_catalog.format('circles_app.%I', v_table));
    IF v_relation IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation_catalog
      WHERE relation_catalog.oid = v_relation
        AND relation_catalog.relkind = 'r'
        AND relation_catalog.relowner = 'postgres'::pg_catalog.regrole
        AND relation_catalog.relrowsecurity
        AND relation_catalog.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'DB-17 requires postgres-owned FORCE RLS table circles_app.%', v_table;
    END IF;

    IF NOT (
      pg_catalog.has_table_privilege('circles_app_runtime', v_relation, 'SELECT')
      AND pg_catalog.has_table_privilege('circles_app_runtime', v_relation, 'INSERT')
      AND pg_catalog.has_table_privilege('circles_app_runtime', v_relation, 'UPDATE')
      AND pg_catalog.has_table_privilege('circles_app_runtime', v_relation, 'DELETE')
    ) THEN
      RAISE EXCEPTION 'DB-17 runtime grant drift on circles_app.%', v_table;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(ARRAY[
        'anon'::pg_catalog.name,
        'authenticated'::pg_catalog.name,
        'service_role'::pg_catalog.name
      ]) AS external_role(role_name)
      CROSS JOIN pg_catalog.unnest(ARRAY[
        'SELECT'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text
      ]) AS operation(privilege_name)
      WHERE pg_catalog.has_table_privilege(external_role.role_name, v_relation, operation.privilege_name)
    ) THEN
      RAISE EXCEPTION 'DB-17 external table-grant drift on circles_app.%', v_table;
    END IF;
  END LOOP;

  FOR v_table, v_column, v_not_null IN
    SELECT * FROM (VALUES
      ('users'::pg_catalog.name, 'id'::pg_catalog.name, true),
      ('circles'::pg_catalog.name, 'id'::pg_catalog.name, true),
      ('streams'::pg_catalog.name, 'id'::pg_catalog.name, true),
      ('streams'::pg_catalog.name, 'hostId'::pg_catalog.name, true),
      ('streams'::pg_catalog.name, 'circleId'::pg_catalog.name, false),
      ('activeHostLeases'::pg_catalog.name, 'hostId'::pg_catalog.name, true),
      ('activeHostLeases'::pg_catalog.name, 'streamId'::pg_catalog.name, false),
      ('liveViewers'::pg_catalog.name, 'streamId'::pg_catalog.name, true),
      ('liveSignals'::pg_catalog.name, 'streamId'::pg_catalog.name, true),
      ('liveChat'::pg_catalog.name, 'streamId'::pg_catalog.name, true)
    ) AS expected(table_name, column_name, is_not_null)
  LOOP
    v_relation := pg_catalog.to_regclass(pg_catalog.format('circles_app.%I', v_table));
    SELECT attribute.attnotnull INTO v_actual_not_null
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = v_relation
      AND attribute.attname = v_column
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.atttypid = 'integer'::pg_catalog.regtype;

    IF NOT FOUND OR v_actual_not_null IS DISTINCT FROM v_not_null THEN
      RAISE EXCEPTION 'DB-17 type/nullability drift for circles_app.%.%', v_table, v_column;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'users_pkey'::pg_catalog.name
      AND contype = 'p'
      AND conrelid = 'circles_app.users'::pg_catalog.regclass
      AND conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'circles_app.users'::pg_catalog.regclass AND attname = 'id'::pg_catalog.name AND NOT attisdropped)]
      AND convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'circles_pkey'::pg_catalog.name
      AND contype = 'p'
      AND conrelid = 'circles_app.circles'::pg_catalog.regclass
      AND conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'circles_app.circles'::pg_catalog.regclass AND attname = 'id'::pg_catalog.name AND NOT attisdropped)]
      AND convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'streams_pkey'::pg_catalog.name
      AND contype = 'p'
      AND conrelid = 'circles_app.streams'::pg_catalog.regclass
      AND conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = 'circles_app.streams'::pg_catalog.regclass AND attname = 'id'::pg_catalog.name AND NOT attisdropped)]
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'DB-17 requires validated integer users/circles/streams primary keys';
  END IF;

  -- Exact current local policy names are checked before any table lock. Predicate values are
  -- intentionally unchanged: this candidate only refuses missing/extra policy inventory.
  FOR v_table, v_expected_policies IN
    SELECT * FROM (VALUES
      ('activeHostLeases'::pg_catalog.name, ARRAY['circles_admin_native_exec_activehostleases'::pg_catalog.name, 'circles_admin_parity_read_activehostleases'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, 'runtime_active_host_leases_policy'::pg_catalog.name]),
      ('liveChat'::pg_catalog.name, ARRAY['circles_admin_parity_read_livechat'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, 'runtime_live_chat_policy'::pg_catalog.name]),
      ('liveSignals'::pg_catalog.name, ARRAY['circles_admin_native_exec_livesignals'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, 'runtime_live_signals_policy'::pg_catalog.name]),
      ('liveViewers'::pg_catalog.name, ARRAY['circles_admin_read_liveviewers'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, 'runtime_live_viewers_policy'::pg_catalog.name]),
      ('streams'::pg_catalog.name, ARRAY['circles_admin_native_exec_streams'::pg_catalog.name, 'circles_admin_read_streams'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, 'runtime_streams_policy'::pg_catalog.name]),
      ('users'::pg_catalog.name, ARRAY['circles_admin_native_exec_users'::pg_catalog.name, 'circles_admin_native_users_lock_only'::pg_catalog.name, 'circles_admin_read_users'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, 'runtime_users_policy'::pg_catalog.name]),
      ('circles'::pg_catalog.name, ARRAY['circles_admin_native_exec_circles'::pg_catalog.name, 'circles_admin_read_circles'::pg_catalog.name, 'circles_app_deny_anon_authenticated'::pg_catalog.name, 'runtime_circles_policy'::pg_catalog.name])
    ) AS expected(table_name, policy_names)
  LOOP
    SELECT pg_catalog.array_agg(policy_catalog.polname ORDER BY policy_catalog.polname)
      INTO v_actual_policies
    FROM pg_catalog.pg_policy AS policy_catalog
    WHERE policy_catalog.polrelid = pg_catalog.to_regclass(pg_catalog.format('circles_app.%I', v_table));

    IF v_actual_policies IS DISTINCT FROM (
      SELECT pg_catalog.array_agg(policy_name ORDER BY policy_name)
      FROM pg_catalog.unnest(v_expected_policies) AS policy_name
    ) THEN
      RAISE EXCEPTION 'DB-17 RLS policy inventory drift on circles_app.%', v_table;
    END IF;
  END LOOP;

  PERFORM pg_temp.db17_assert_live_fk('streams', 'hostId', 'users', 'streams_host_id_db17_fkey', 'r', false, false);
  PERFORM pg_temp.db17_assert_live_fk('streams', 'circleId', 'circles', 'streams_circle_id_db17_fkey', 'n', false, false);
  PERFORM pg_temp.db17_assert_live_fk('activeHostLeases', 'hostId', 'users', 'active_host_leases_host_id_db17_fkey', 'c', false, false);
  PERFORM pg_temp.db17_assert_live_fk('activeHostLeases', 'streamId', 'streams', 'active_host_leases_stream_id_db17_fkey', 'n', false, false);
  PERFORM pg_temp.db17_assert_live_fk('liveViewers', 'streamId', 'streams', 'live_viewers_stream_id_db17_fkey', 'r', false, false);
  PERFORM pg_temp.db17_assert_live_fk('liveSignals', 'streamId', 'streams', 'live_signals_stream_id_db17_fkey', 'c', false, false);
  PERFORM pg_temp.db17_assert_live_fk('liveChat', 'streamId', 'streams', 'live_chat_stream_id_db17_fkey', 'r', false, false);
END;
$db17_contract$;

SELECT pg_temp.db17_assert_current_contract();

-- Fresh aggregate-only historical checks. They intentionally return no application row values.
DO $db17_orphans$
DECLARE
  v_stream_host_orphans bigint;
  v_stream_circle_orphans bigint;
  v_lease_host_orphans bigint;
  v_lease_stream_orphans bigint;
  v_viewer_stream_orphans bigint;
  v_signal_stream_orphans bigint;
  v_chat_stream_orphans bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM circles_app.streams AS child LEFT JOIN circles_app.users AS parent ON parent.id = child."hostId" WHERE parent.id IS NULL),
    (SELECT count(*) FROM circles_app.streams AS child LEFT JOIN circles_app.circles AS parent ON parent.id = child."circleId" WHERE child."circleId" IS NOT NULL AND parent.id IS NULL),
    (SELECT count(*) FROM circles_app."activeHostLeases" AS child LEFT JOIN circles_app.users AS parent ON parent.id = child."hostId" WHERE parent.id IS NULL),
    (SELECT count(*) FROM circles_app."activeHostLeases" AS child LEFT JOIN circles_app.streams AS parent ON parent.id = child."streamId" WHERE child."streamId" IS NOT NULL AND parent.id IS NULL),
    (SELECT count(*) FROM circles_app."liveViewers" AS child LEFT JOIN circles_app.streams AS parent ON parent.id = child."streamId" WHERE parent.id IS NULL),
    (SELECT count(*) FROM circles_app."liveSignals" AS child LEFT JOIN circles_app.streams AS parent ON parent.id = child."streamId" WHERE parent.id IS NULL),
    (SELECT count(*) FROM circles_app."liveChat" AS child LEFT JOIN circles_app.streams AS parent ON parent.id = child."streamId" WHERE parent.id IS NULL)
  INTO v_stream_host_orphans, v_stream_circle_orphans, v_lease_host_orphans,
       v_lease_stream_orphans, v_viewer_stream_orphans, v_signal_stream_orphans,
       v_chat_stream_orphans;

  IF v_stream_host_orphans <> 0 OR v_stream_circle_orphans <> 0
     OR v_lease_host_orphans <> 0 OR v_lease_stream_orphans <> 0
     OR v_viewer_stream_orphans <> 0 OR v_signal_stream_orphans <> 0
     OR v_chat_stream_orphans <> 0 THEN
    RAISE EXCEPTION
      'DB-17 historical orphan aggregate check failed (stream_host %, stream_circle %, lease_host %, lease_stream %, viewer_stream %, signal_stream %, chat_stream %); stop without normalizing rows',
      v_stream_host_orphans, v_stream_circle_orphans, v_lease_host_orphans,
      v_lease_stream_orphans, v_viewer_stream_orphans, v_signal_stream_orphans,
      v_chat_stream_orphans;
  END IF;
END;
$db17_orphans$;

-- Existing primary keys cover activeHostLeases.hostId and the leading liveViewers.streamId.
-- The remaining five child references need independent, bounded concurrent B-tree coverage.
SELECT pg_temp.db17_assert_child_index('activeHostLeases', 'activeHostLeases_pkey', ARRAY['hostId'::pg_catalog.name], true, true, true);
SELECT pg_temp.db17_assert_child_index('liveViewers', 'liveViewers_pkey', ARRAY['streamId'::pg_catalog.name, 'userId'::pg_catalog.name], true, true, true);
SELECT pg_temp.db17_assert_child_index('streams', 'streams_host_id_db17_fk_idx', ARRAY['hostId'::pg_catalog.name], false, false, false);
SELECT pg_temp.db17_assert_child_index('streams', 'streams_circle_id_db17_fk_idx', ARRAY['circleId'::pg_catalog.name], false, false, false);
SELECT pg_temp.db17_assert_child_index('activeHostLeases', 'active_host_leases_stream_id_db17_fk_idx', ARRAY['streamId'::pg_catalog.name], false, false, false);
SELECT pg_temp.db17_assert_child_index('liveSignals', 'live_signals_stream_id_db17_fk_idx', ARRAY['streamId'::pg_catalog.name], false, false, false);
SELECT pg_temp.db17_assert_child_index('liveChat', 'live_chat_stream_id_db17_fk_idx', ARRAY['streamId'::pg_catalog.name], false, false, false);

-- These must remain top-level autocommit statements. No existing index is dropped/rebuilt.
CREATE INDEX CONCURRENTLY IF NOT EXISTS streams_host_id_db17_fk_idx
  ON circles_app.streams USING btree ("hostId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS streams_circle_id_db17_fk_idx
  ON circles_app.streams USING btree ("circleId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS active_host_leases_stream_id_db17_fk_idx
  ON circles_app."activeHostLeases" USING btree ("streamId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS live_signals_stream_id_db17_fk_idx
  ON circles_app."liveSignals" USING btree ("streamId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS live_chat_stream_id_db17_fk_idx
  ON circles_app."liveChat" USING btree ("streamId");

SELECT pg_temp.db17_assert_child_index('streams', 'streams_host_id_db17_fk_idx', ARRAY['hostId'::pg_catalog.name], false, false, true);
SELECT pg_temp.db17_assert_child_index('streams', 'streams_circle_id_db17_fk_idx', ARRAY['circleId'::pg_catalog.name], false, false, true);
SELECT pg_temp.db17_assert_child_index('activeHostLeases', 'active_host_leases_stream_id_db17_fk_idx', ARRAY['streamId'::pg_catalog.name], false, false, true);
SELECT pg_temp.db17_assert_child_index('liveSignals', 'live_signals_stream_id_db17_fk_idx', ARRAY['streamId'::pg_catalog.name], false, false, true);
SELECT pg_temp.db17_assert_child_index('liveChat', 'live_chat_stream_id_db17_fk_idx', ARRAY['streamId'::pg_catalog.name], false, false, true);

-- Install only missing exact constraints. The immediately following VALIDATE statements make a
-- successful close fully historical, rather than leaving a NOT VALID future-write-only claim.
DO $db17_add_live_fks$
BEGIN
  PERFORM pg_temp.db17_assert_current_contract();

  IF pg_catalog.to_regclass('circles_app.streams') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'streams_host_id_db17_fkey'::pg_catalog.name) THEN
    ALTER TABLE circles_app.streams ADD CONSTRAINT streams_host_id_db17_fkey
      FOREIGN KEY ("hostId") REFERENCES circles_app.users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'streams_circle_id_db17_fkey'::pg_catalog.name) THEN
    ALTER TABLE circles_app.streams ADD CONSTRAINT streams_circle_id_db17_fkey
      FOREIGN KEY ("circleId") REFERENCES circles_app.circles(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'active_host_leases_host_id_db17_fkey'::pg_catalog.name) THEN
    ALTER TABLE circles_app."activeHostLeases" ADD CONSTRAINT active_host_leases_host_id_db17_fkey
      FOREIGN KEY ("hostId") REFERENCES circles_app.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'active_host_leases_stream_id_db17_fkey'::pg_catalog.name) THEN
    ALTER TABLE circles_app."activeHostLeases" ADD CONSTRAINT active_host_leases_stream_id_db17_fkey
      FOREIGN KEY ("streamId") REFERENCES circles_app.streams(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'live_viewers_stream_id_db17_fkey'::pg_catalog.name) THEN
    ALTER TABLE circles_app."liveViewers" ADD CONSTRAINT live_viewers_stream_id_db17_fkey
      FOREIGN KEY ("streamId") REFERENCES circles_app.streams(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'live_signals_stream_id_db17_fkey'::pg_catalog.name) THEN
    ALTER TABLE circles_app."liveSignals" ADD CONSTRAINT live_signals_stream_id_db17_fkey
      FOREIGN KEY ("streamId") REFERENCES circles_app.streams(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'live_chat_stream_id_db17_fkey'::pg_catalog.name) THEN
    ALTER TABLE circles_app."liveChat" ADD CONSTRAINT live_chat_stream_id_db17_fkey
      FOREIGN KEY ("streamId") REFERENCES circles_app.streams(id) ON DELETE RESTRICT NOT VALID;
  END IF;

  PERFORM pg_temp.db17_assert_live_fk('streams', 'hostId', 'users', 'streams_host_id_db17_fkey', 'r', true, false);
  PERFORM pg_temp.db17_assert_live_fk('streams', 'circleId', 'circles', 'streams_circle_id_db17_fkey', 'n', true, false);
  PERFORM pg_temp.db17_assert_live_fk('activeHostLeases', 'hostId', 'users', 'active_host_leases_host_id_db17_fkey', 'c', true, false);
  PERFORM pg_temp.db17_assert_live_fk('activeHostLeases', 'streamId', 'streams', 'active_host_leases_stream_id_db17_fkey', 'n', true, false);
  PERFORM pg_temp.db17_assert_live_fk('liveViewers', 'streamId', 'streams', 'live_viewers_stream_id_db17_fkey', 'r', true, false);
  PERFORM pg_temp.db17_assert_live_fk('liveSignals', 'streamId', 'streams', 'live_signals_stream_id_db17_fkey', 'c', true, false);
  PERFORM pg_temp.db17_assert_live_fk('liveChat', 'streamId', 'streams', 'live_chat_stream_id_db17_fkey', 'r', true, false);
END;
$db17_add_live_fks$;

ALTER TABLE circles_app.streams VALIDATE CONSTRAINT streams_host_id_db17_fkey;
ALTER TABLE circles_app.streams VALIDATE CONSTRAINT streams_circle_id_db17_fkey;
ALTER TABLE circles_app."activeHostLeases" VALIDATE CONSTRAINT active_host_leases_host_id_db17_fkey;
ALTER TABLE circles_app."activeHostLeases" VALIDATE CONSTRAINT active_host_leases_stream_id_db17_fkey;
ALTER TABLE circles_app."liveViewers" VALIDATE CONSTRAINT live_viewers_stream_id_db17_fkey;
ALTER TABLE circles_app."liveSignals" VALIDATE CONSTRAINT live_signals_stream_id_db17_fkey;
ALTER TABLE circles_app."liveChat" VALIDATE CONSTRAINT live_chat_stream_id_db17_fkey;

SELECT pg_temp.db17_assert_current_contract();
SELECT pg_temp.db17_assert_live_fk('streams', 'hostId', 'users', 'streams_host_id_db17_fkey', 'r', true, true);
SELECT pg_temp.db17_assert_live_fk('streams', 'circleId', 'circles', 'streams_circle_id_db17_fkey', 'n', true, true);
SELECT pg_temp.db17_assert_live_fk('activeHostLeases', 'hostId', 'users', 'active_host_leases_host_id_db17_fkey', 'c', true, true);
SELECT pg_temp.db17_assert_live_fk('activeHostLeases', 'streamId', 'streams', 'active_host_leases_stream_id_db17_fkey', 'n', true, true);
SELECT pg_temp.db17_assert_live_fk('liveViewers', 'streamId', 'streams', 'live_viewers_stream_id_db17_fkey', 'r', true, true);
SELECT pg_temp.db17_assert_live_fk('liveSignals', 'streamId', 'streams', 'live_signals_stream_id_db17_fkey', 'c', true, true);
SELECT pg_temp.db17_assert_live_fk('liveChat', 'streamId', 'streams', 'live_chat_stream_id_db17_fkey', 'r', true, true);

DROP FUNCTION pg_temp.db17_assert_current_contract();
DROP FUNCTION pg_temp.db17_assert_live_fk(pg_catalog.name, pg_catalog.name, pg_catalog.name, pg_catalog.name, "char", boolean, boolean);
DROP FUNCTION pg_temp.db17_assert_child_index(pg_catalog.name, pg_catalog.name, pg_catalog.name[], boolean, boolean, boolean);
DROP FUNCTION pg_temp.db17_assert_gate();
SELECT pg_catalog.pg_advisory_unlock(
  pg_catalog.hashtextextended('circles.db17.live_relationships.v1', 0)
) AS db17_live_relationships_advisory_lock_released;
RESET lock_timeout;
RESET statement_timeout;

\echo 'DB-17: all seven approved live-reference FKs are exact and validated; no NOT VALID state remains.'
