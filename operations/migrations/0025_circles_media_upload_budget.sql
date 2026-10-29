-- CBA-06: durable reserve-before-PUT media object budgets.
--
-- Prepared only. This additive migration creates a separate private circles_media schema for
-- account-scoped reservation accounting. It preserves the exact 27-table circles_app contract,
-- does not call a provider, delete an object, start a scheduler, or free quota. Existing recorded
-- metadata is backfilled conservatively using the known 36-byte encrypted frame overhead.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('circles.cba06.circles-media-upload-budget.v1'::pg_catalog.text, 0)
);

DO $cba06_preflight$
DECLARE
  v_social_uploads pg_catalog.oid;
  v_bad_contract boolean;
BEGIN
  SELECT relation_catalog.oid
    INTO v_social_uploads
    FROM pg_catalog.pg_class AS relation_catalog
    INNER JOIN pg_catalog.pg_namespace AS namespace_catalog
      ON namespace_catalog.oid = relation_catalog.relnamespace
   WHERE namespace_catalog.nspname = 'circles_app'::pg_catalog.name
     AND relation_catalog.relname = 'socialUploads'::pg_catalog.name
     AND relation_catalog.relkind = 'r'::pg_catalog."char";
  IF v_social_uploads IS NULL THEN
    RAISE EXCEPTION 'CBA-06 requires circles_app."socialUploads" as an ordinary table';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM (VALUES
        ('userId'::pg_catalog.name, 'integer'::pg_catalog.text),
        ('storageKey'::pg_catalog.name, 'character varying'::pg_catalog.text),
        ('url'::pg_catalog.name, 'character varying'::pg_catalog.text),
        ('bytes'::pg_catalog.name, 'integer'::pg_catalog.text),
        ('createdAt'::pg_catalog.name, 'timestamp with time zone'::pg_catalog.text),
        ('claimedAt'::pg_catalog.name, 'timestamp with time zone'::pg_catalog.text)
      ) AS expected(attribute_name, expected_type)
      LEFT JOIN pg_catalog.pg_attribute AS attribute_catalog
        ON attribute_catalog.attrelid = v_social_uploads
       AND attribute_catalog.attname = expected.attribute_name
       AND NOT attribute_catalog.attisdropped
     WHERE attribute_catalog.attnum IS NULL
        OR attribute_catalog.atttypid <> expected.expected_type::pg_catalog.regtype
        OR (expected.attribute_name <> 'claimedAt'::pg_catalog.name AND NOT attribute_catalog.attnotnull)
  ) INTO v_bad_contract;
  IF v_bad_contract THEN
    RAISE EXCEPTION 'CBA-06 found an incompatible circles_app."socialUploads" contract';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace
    WHERE nspname = 'circles_media'::pg_catalog.name
  ) THEN
    RAISE EXCEPTION 'CBA-06 circles_media schema already exists';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation_catalog
      INNER JOIN pg_catalog.pg_namespace AS namespace_catalog
        ON namespace_catalog.oid = relation_catalog.relnamespace
     WHERE namespace_catalog.nspname = 'circles_app'::pg_catalog.name
       AND relation_catalog.relname IN (
         'socialUploadBudgets'::pg_catalog.name,
         'socialUploadReservations'::pg_catalog.name
       )
  ) THEN
    RAISE EXCEPTION 'CBA-06 legacy circles_app upload budget relations must not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'circles_app_runtime'::pg_catalog.name
      AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'CBA-06 requires the restricted circles_app_runtime role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'anon'::pg_catalog.name
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'authenticated'::pg_catalog.name
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'service_role'::pg_catalog.name
  ) THEN
    RAISE EXCEPTION 'CBA-06 requires reviewed API roles for explicit denial';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM circles_app."socialUploads" AS upload
     WHERE upload.bytes IS NULL OR upload.bytes < 1 OR upload.bytes > 2147483611
  ) THEN
    RAISE EXCEPTION 'CBA-06 requires positive bounded legacy social upload byte metadata';
  END IF;
END;
$cba06_preflight$;

CREATE SCHEMA circles_media AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA circles_media FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA circles_media TO circles_app_runtime;

CREATE TABLE circles_media."socialUploadBudgets" (
  "userId" integer PRIMARY KEY,
  "reservedObjects" integer NOT NULL DEFAULT 0,
  "reservedBytes" bigint NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_upload_budgets_objects_check CHECK ("reservedObjects" >= 0),
  CONSTRAINT social_upload_budgets_bytes_check CHECK ("reservedBytes" >= 0)
);

CREATE TABLE circles_media."socialUploadReservations" (
  "reservationId" varchar(64) PRIMARY KEY,
  "userId" integer NOT NULL,
  "storageKey" varchar(1024) NOT NULL,
  url varchar(2048) NOT NULL,
  "objectBytes" integer NOT NULL,
  state varchar(24) NOT NULL,
  "putStartedAt" timestamptz NOT NULL DEFAULT now(),
  "putConfirmedAt" timestamptz,
  "metadataRecordedAt" timestamptz,
  CONSTRAINT social_upload_reservations_storage_key_unique UNIQUE ("storageKey"),
  CONSTRAINT social_upload_reservations_object_bytes_check CHECK ("objectBytes" > 0),
  CONSTRAINT social_upload_reservations_state_check CHECK (
    state IN ('put_started', 'uploaded', 'recorded')
  )
);
CREATE INDEX social_upload_reservations_user_idx
  ON circles_media."socialUploadReservations" ("userId");
CREATE INDEX social_upload_reservations_reconcile_idx
  ON circles_media."socialUploadReservations" (state, "putStartedAt", "reservationId");

-- Preserve every known existing object as charged capacity. These legacy rows predate the new
-- reservation state machine, so they are treated as recorded and retain their original timestamps.
INSERT INTO circles_media."socialUploadReservations" (
  "reservationId", "userId", "storageKey", url, "objectBytes", state,
  "putStartedAt", "putConfirmedAt", "metadataRecordedAt"
)
SELECT
  'legacy-social-upload-' || upload.id::pg_catalog.text,
  upload."userId",
  upload."storageKey",
  upload.url,
  upload.bytes + 36,
  'recorded',
  upload."createdAt",
  upload."createdAt",
  upload."createdAt"
FROM circles_app."socialUploads" AS upload;

INSERT INTO circles_media."socialUploadBudgets" (
  "userId", "reservedObjects", "reservedBytes", "createdAt", "updatedAt"
)
SELECT
  reservation."userId",
  pg_catalog.count(*)::integer,
  pg_catalog.sum(reservation."objectBytes"),
  pg_catalog.min(reservation."putStartedAt"),
  pg_catalog.max(reservation."putStartedAt")
FROM circles_media."socialUploadReservations" AS reservation
GROUP BY reservation."userId";

REVOKE ALL ON TABLE circles_media."socialUploadBudgets", circles_media."socialUploadReservations"
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE
  circles_media."socialUploadBudgets", circles_media."socialUploadReservations"
TO circles_app_runtime;
ALTER TABLE circles_media."socialUploadBudgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles_media."socialUploadBudgets" FORCE ROW LEVEL SECURITY;
ALTER TABLE circles_media."socialUploadReservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles_media."socialUploadReservations" FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_social_upload_budgets_policy
  ON circles_media."socialUploadBudgets"
  FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_social_upload_reservations_policy
  ON circles_media."socialUploadReservations"
  FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true);

DO $cba06_postcondition$
DECLARE
  v_budget_count integer;
  v_reservation_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO v_budget_count
    FROM circles_media."socialUploadBudgets";
  SELECT pg_catalog.count(*)::integer
    INTO v_reservation_count
    FROM circles_media."socialUploadReservations";
  IF v_reservation_count <> (SELECT pg_catalog.count(*)::integer FROM circles_app."socialUploads")
     OR v_budget_count <> (
       SELECT pg_catalog.count(DISTINCT upload."userId")::integer
       FROM circles_app."socialUploads" AS upload
     ) THEN
    RAISE EXCEPTION 'CBA-06 legacy upload budget backfill postcondition failed';
  END IF;
END;
$cba06_postcondition$;
COMMIT;
