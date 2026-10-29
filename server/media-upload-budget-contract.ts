import { getDb, type CirclesDatabase } from "./db";
import { withOperationDeadline } from "./_core/bounded-network";

export const MEDIA_UPLOAD_BUDGET_CONTRACT_VARIANT =
  "cba06_circles_media_v1" as const;
export const MEDIA_UPLOAD_BUDGET_UNAVAILABLE_VARIANT =
  "unavailable_or_drifted" as const;
export const MEDIA_UPLOAD_BUDGET_READINESS_DEADLINE_MS = 5_000;

type MediaUploadBudgetContractVariant =
  | typeof MEDIA_UPLOAD_BUDGET_CONTRACT_VARIANT
  | typeof MEDIA_UPLOAD_BUDGET_UNAVAILABLE_VARIANT;

/** Catalog-only outcome; it intentionally contains no account, reservation, or storage-key data. */
export type MediaUploadBudgetContractEvidence = {
  contract_variant: MediaUploadBudgetContractVariant;
};

export type MediaUploadBudgetStatus = {
  ready: boolean;
};

/**
 * The media ledger has an intentionally separate exact contract from the immutable 27-table
 * circles_app health inventory. This query accepts one finite CBA-06 catalog state, not a table
 * count, name pattern, role wildcard, or permissive ACL/RLS approximation.
 */
export const MEDIA_UPLOAD_BUDGET_AUDIT_SQL = `
  WITH runtime_role AS (
    SELECT role_catalog.oid AS role_oid, role_catalog.rolcanlogin,
      role_catalog.rolinherit, role_catalog.rolsuper, role_catalog.rolbypassrls
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname = 'circles_app_runtime'::pg_catalog.name
  ), api_roles AS (
    SELECT role_catalog.oid AS role_oid
    FROM pg_catalog.pg_roles AS role_catalog
    WHERE role_catalog.rolname IN (
      'anon'::pg_catalog.name,
      'authenticated'::pg_catalog.name,
      'service_role'::pg_catalog.name
    )
  ), media_schema AS (
    SELECT namespace_catalog.oid AS namespace_oid, namespace_catalog.nspowner,
      namespace_catalog.nspacl
    FROM pg_catalog.pg_namespace AS namespace_catalog
    WHERE namespace_catalog.nspname = 'circles_media'::pg_catalog.name
  ), expected_tables(table_name) AS (
    VALUES
      ('socialUploadBudgets'::pg_catalog.name),
      ('socialUploadReservations'::pg_catalog.name)
  ), ledger_tables AS (
    SELECT expected_tables.table_name, relation_catalog.oid, relation_catalog.relowner,
      relation_catalog.relrowsecurity, relation_catalog.relforcerowsecurity, relation_catalog.relacl
    FROM expected_tables
    LEFT JOIN media_schema ON true
    LEFT JOIN pg_catalog.pg_class AS relation_catalog
      ON relation_catalog.relnamespace = media_schema.namespace_oid
     AND relation_catalog.relname = expected_tables.table_name
     AND relation_catalog.relkind = 'r'::pg_catalog."char"
  ), expected_columns(table_name, column_name, ordinal, data_type, not_null) AS (
    VALUES
      ('socialUploadBudgets'::pg_catalog.name, 'userId'::pg_catalog.name, 1::pg_catalog.int2, 'integer'::pg_catalog.text, true),
      ('socialUploadBudgets'::pg_catalog.name, 'reservedObjects'::pg_catalog.name, 2::pg_catalog.int2, 'integer'::pg_catalog.text, true),
      ('socialUploadBudgets'::pg_catalog.name, 'reservedBytes'::pg_catalog.name, 3::pg_catalog.int2, 'bigint'::pg_catalog.text, true),
      ('socialUploadBudgets'::pg_catalog.name, 'createdAt'::pg_catalog.name, 4::pg_catalog.int2, 'timestamp with time zone'::pg_catalog.text, true),
      ('socialUploadBudgets'::pg_catalog.name, 'updatedAt'::pg_catalog.name, 5::pg_catalog.int2, 'timestamp with time zone'::pg_catalog.text, true),
      ('socialUploadReservations'::pg_catalog.name, 'reservationId'::pg_catalog.name, 1::pg_catalog.int2, 'character varying(64)'::pg_catalog.text, true),
      ('socialUploadReservations'::pg_catalog.name, 'userId'::pg_catalog.name, 2::pg_catalog.int2, 'integer'::pg_catalog.text, true),
      ('socialUploadReservations'::pg_catalog.name, 'storageKey'::pg_catalog.name, 3::pg_catalog.int2, 'character varying(1024)'::pg_catalog.text, true),
      ('socialUploadReservations'::pg_catalog.name, 'url'::pg_catalog.name, 4::pg_catalog.int2, 'character varying(2048)'::pg_catalog.text, true),
      ('socialUploadReservations'::pg_catalog.name, 'objectBytes'::pg_catalog.name, 5::pg_catalog.int2, 'integer'::pg_catalog.text, true),
      ('socialUploadReservations'::pg_catalog.name, 'state'::pg_catalog.name, 6::pg_catalog.int2, 'character varying(24)'::pg_catalog.text, true),
      ('socialUploadReservations'::pg_catalog.name, 'putStartedAt'::pg_catalog.name, 7::pg_catalog.int2, 'timestamp with time zone'::pg_catalog.text, true),
      ('socialUploadReservations'::pg_catalog.name, 'putConfirmedAt'::pg_catalog.name, 8::pg_catalog.int2, 'timestamp with time zone'::pg_catalog.text, false),
      ('socialUploadReservations'::pg_catalog.name, 'metadataRecordedAt'::pg_catalog.name, 9::pg_catalog.int2, 'timestamp with time zone'::pg_catalog.text, false)
  ), expected_constraints(table_name, constraint_name, constraint_kind, key_columns) AS (
    VALUES
      ('socialUploadBudgets'::pg_catalog.name, 'socialUploadBudgets_pkey'::pg_catalog.name, 'p'::pg_catalog."char", ARRAY[1]::pg_catalog.int2[]),
      ('socialUploadBudgets'::pg_catalog.name, 'social_upload_budgets_objects_check'::pg_catalog.name, 'c'::pg_catalog."char", NULL::pg_catalog.int2[]),
      ('socialUploadBudgets'::pg_catalog.name, 'social_upload_budgets_bytes_check'::pg_catalog.name, 'c'::pg_catalog."char", NULL::pg_catalog.int2[]),
      ('socialUploadReservations'::pg_catalog.name, 'socialUploadReservations_pkey'::pg_catalog.name, 'p'::pg_catalog."char", ARRAY[1]::pg_catalog.int2[]),
      ('socialUploadReservations'::pg_catalog.name, 'social_upload_reservations_storage_key_unique'::pg_catalog.name, 'u'::pg_catalog."char", ARRAY[3]::pg_catalog.int2[]),
      ('socialUploadReservations'::pg_catalog.name, 'social_upload_reservations_object_bytes_check'::pg_catalog.name, 'c'::pg_catalog."char", NULL::pg_catalog.int2[]),
      ('socialUploadReservations'::pg_catalog.name, 'social_upload_reservations_state_check'::pg_catalog.name, 'c'::pg_catalog."char", NULL::pg_catalog.int2[])
  ), expected_indexes(table_name, index_name, unique_index, primary_index, key_count, first_key, second_key, third_key) AS (
    VALUES
      ('socialUploadBudgets'::pg_catalog.name, 'socialUploadBudgets_pkey'::pg_catalog.name, true, true, 1::pg_catalog.int2, '"userId"'::pg_catalog.text, NULL::pg_catalog.text, NULL::pg_catalog.text),
      ('socialUploadReservations'::pg_catalog.name, 'socialUploadReservations_pkey'::pg_catalog.name, true, true, 1::pg_catalog.int2, '"reservationId"'::pg_catalog.text, NULL::pg_catalog.text, NULL::pg_catalog.text),
      ('socialUploadReservations'::pg_catalog.name, 'social_upload_reservations_storage_key_unique'::pg_catalog.name, true, false, 1::pg_catalog.int2, '"storageKey"'::pg_catalog.text, NULL::pg_catalog.text, NULL::pg_catalog.text),
      ('socialUploadReservations'::pg_catalog.name, 'social_upload_reservations_user_idx'::pg_catalog.name, false, false, 1::pg_catalog.int2, '"userId"'::pg_catalog.text, NULL::pg_catalog.text, NULL::pg_catalog.text),
      ('socialUploadReservations'::pg_catalog.name, 'social_upload_reservations_reconcile_idx'::pg_catalog.name, false, false, 3::pg_catalog.int2, 'state'::pg_catalog.text, '"putStartedAt"'::pg_catalog.text, '"reservationId"'::pg_catalog.text)
  ), expected_policies(table_name, policy_name) AS (
    VALUES
      ('socialUploadBudgets'::pg_catalog.name, 'runtime_social_upload_budgets_policy'::pg_catalog.name),
      ('socialUploadReservations'::pg_catalog.name, 'runtime_social_upload_reservations_policy'::pg_catalog.name)
  )
  SELECT CASE WHEN
    current_user = 'circles_app_runtime'::pg_catalog.name
    AND (SELECT pg_catalog.count(*) FROM runtime_role) = 1
    AND (SELECT NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls FROM runtime_role)
    AND (SELECT pg_catalog.count(*) FROM api_roles) = 3
    AND (SELECT pg_catalog.count(*) FROM media_schema) = 1
    AND (SELECT nspowner = (SELECT owner_role.oid FROM pg_catalog.pg_roles AS owner_role WHERE owner_role.rolname = 'postgres'::pg_catalog.name) FROM media_schema)
    AND pg_catalog.has_schema_privilege((SELECT role_oid FROM runtime_role), (SELECT namespace_oid FROM media_schema), 'USAGE'::pg_catalog.text)
    AND NOT pg_catalog.has_schema_privilege((SELECT role_oid FROM runtime_role), (SELECT namespace_oid FROM media_schema), 'CREATE'::pg_catalog.text)
    AND NOT EXISTS (
      SELECT 1
      FROM api_roles
      WHERE pg_catalog.has_schema_privilege(api_roles.role_oid, (SELECT namespace_oid FROM media_schema), 'USAGE'::pg_catalog.text)
         OR pg_catalog.has_schema_privilege(api_roles.role_oid, (SELECT namespace_oid FROM media_schema), 'CREATE'::pg_catalog.text)
    )
    AND (
      SELECT pg_catalog.count(*)
      FROM media_schema AS schema_catalog
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(schema_catalog.nspacl, pg_catalog.acldefault('n'::pg_catalog."char", schema_catalog.nspowner))
      ) AS acl
    ) = 3
    AND NOT EXISTS (
      SELECT 1
      FROM media_schema AS schema_catalog
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(schema_catalog.nspacl, pg_catalog.acldefault('n'::pg_catalog."char", schema_catalog.nspowner))
      ) AS acl
      WHERE acl.is_grantable
         OR acl.grantee NOT IN (schema_catalog.nspowner, (SELECT role_oid FROM runtime_role))
         OR (acl.grantee = schema_catalog.nspowner AND acl.privilege_type NOT IN ('USAGE'::pg_catalog.text, 'CREATE'::pg_catalog.text))
         OR (acl.grantee = (SELECT role_oid FROM runtime_role) AND acl.privilege_type <> 'USAGE'::pg_catalog.text)
    )
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class AS relation_catalog
         WHERE relation_catalog.relnamespace = (SELECT namespace_oid FROM media_schema)
           AND relation_catalog.relkind = 'r'::pg_catalog."char") = 2
    AND NOT EXISTS (
      SELECT 1 FROM ledger_tables
      WHERE oid IS NULL
         OR relowner <> (SELECT owner_role.oid FROM pg_catalog.pg_roles AS owner_role WHERE owner_role.rolname = 'postgres'::pg_catalog.name)
         OR NOT relrowsecurity OR NOT relforcerowsecurity
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ledger_tables AS relation_catalog
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(relation_catalog.relacl, pg_catalog.acldefault('r'::pg_catalog."char", relation_catalog.relowner))
      ) AS acl
      WHERE relation_catalog.oid IS NULL
         OR acl.is_grantable
         OR acl.grantee NOT IN (relation_catalog.relowner, (SELECT role_oid FROM runtime_role))
         OR (acl.grantee = relation_catalog.relowner AND acl.privilege_type NOT IN (
           'SELECT'::pg_catalog.text, 'INSERT'::pg_catalog.text, 'UPDATE'::pg_catalog.text,
           'DELETE'::pg_catalog.text, 'TRUNCATE'::pg_catalog.text, 'REFERENCES'::pg_catalog.text,
           'TRIGGER'::pg_catalog.text, 'MAINTAIN'::pg_catalog.text
         ))
         OR (acl.grantee = (SELECT role_oid FROM runtime_role) AND acl.privilege_type NOT IN (
           'SELECT'::pg_catalog.text, 'INSERT'::pg_catalog.text, 'UPDATE'::pg_catalog.text
         ))
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ledger_tables AS relation_catalog
      CROSS JOIN api_roles
      CROSS JOIN (VALUES
        ('SELECT'::pg_catalog.text), ('INSERT'::pg_catalog.text), ('UPDATE'::pg_catalog.text),
        ('DELETE'::pg_catalog.text), ('TRUNCATE'::pg_catalog.text), ('REFERENCES'::pg_catalog.text),
        ('TRIGGER'::pg_catalog.text), ('MAINTAIN'::pg_catalog.text)
      ) AS prohibited(privilege_type)
      WHERE relation_catalog.oid IS NULL
         OR pg_catalog.has_table_privilege(api_roles.role_oid, relation_catalog.oid, prohibited.privilege_type)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ledger_tables AS relation_catalog
      CROSS JOIN (VALUES
        ('SELECT'::pg_catalog.text), ('INSERT'::pg_catalog.text), ('UPDATE'::pg_catalog.text)
      ) AS required(privilege_type)
      WHERE relation_catalog.oid IS NULL
         OR NOT pg_catalog.has_table_privilege((SELECT role_oid FROM runtime_role), relation_catalog.oid, required.privilege_type)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ledger_tables AS relation_catalog
      CROSS JOIN (VALUES
        ('DELETE'::pg_catalog.text), ('TRUNCATE'::pg_catalog.text), ('REFERENCES'::pg_catalog.text),
        ('TRIGGER'::pg_catalog.text), ('MAINTAIN'::pg_catalog.text)
      ) AS prohibited(privilege_type)
      WHERE relation_catalog.oid IS NULL
         OR pg_catalog.has_table_privilege((SELECT role_oid FROM runtime_role), relation_catalog.oid, prohibited.privilege_type)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM expected_columns
      LEFT JOIN ledger_tables
        ON ledger_tables.table_name = expected_columns.table_name
      LEFT JOIN pg_catalog.pg_attribute AS attribute_catalog
        ON attribute_catalog.attrelid = ledger_tables.oid
       AND attribute_catalog.attname = expected_columns.column_name
       AND attribute_catalog.attnum = expected_columns.ordinal
       AND attribute_catalog.attnum > 0
       AND NOT attribute_catalog.attisdropped
      WHERE attribute_catalog.attnum IS NULL
         OR attribute_catalog.attnotnull IS DISTINCT FROM expected_columns.not_null
         OR pg_catalog.format_type(attribute_catalog.atttypid, attribute_catalog.atttypmod) <> expected_columns.data_type
    )
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute AS attribute_catalog
         WHERE attribute_catalog.attrelid = (SELECT oid FROM ledger_tables WHERE table_name = 'socialUploadBudgets'::pg_catalog.name)
           AND attribute_catalog.attnum > 0 AND NOT attribute_catalog.attisdropped) = 5
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute AS attribute_catalog
         WHERE attribute_catalog.attrelid = (SELECT oid FROM ledger_tables WHERE table_name = 'socialUploadReservations'::pg_catalog.name)
           AND attribute_catalog.attnum > 0 AND NOT attribute_catalog.attisdropped) = 9
    AND NOT EXISTS (
      SELECT 1
      FROM expected_constraints
      LEFT JOIN ledger_tables ON ledger_tables.table_name = expected_constraints.table_name
      LEFT JOIN pg_catalog.pg_constraint AS constraint_catalog
        ON constraint_catalog.conrelid = ledger_tables.oid
       AND constraint_catalog.conname = expected_constraints.constraint_name
       AND constraint_catalog.contype = expected_constraints.constraint_kind
       AND constraint_catalog.convalidated
       AND NOT constraint_catalog.condeferrable
       AND NOT constraint_catalog.condeferred
       AND (expected_constraints.key_columns IS NULL OR constraint_catalog.conkey::pg_catalog.int2[] = expected_constraints.key_columns)
      WHERE constraint_catalog.oid IS NULL
    )
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint
         WHERE conrelid = (SELECT oid FROM ledger_tables WHERE table_name = 'socialUploadBudgets'::pg_catalog.name)) = 3
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint
         WHERE conrelid = (SELECT oid FROM ledger_tables WHERE table_name = 'socialUploadReservations'::pg_catalog.name)) = 4
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conrelid = (SELECT oid FROM ledger_tables WHERE table_name = 'socialUploadBudgets'::pg_catalog.name)
        AND constraint_catalog.conname = 'social_upload_budgets_objects_check'::pg_catalog.name
        AND pg_catalog.pg_get_expr(constraint_catalog.conbin, constraint_catalog.conrelid) = '("reservedObjects" >= 0)'::pg_catalog.text
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conrelid = (SELECT oid FROM ledger_tables WHERE table_name = 'socialUploadBudgets'::pg_catalog.name)
        AND constraint_catalog.conname = 'social_upload_budgets_bytes_check'::pg_catalog.name
        AND pg_catalog.pg_get_expr(constraint_catalog.conbin, constraint_catalog.conrelid) = '("reservedBytes" >= 0)'::pg_catalog.text
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conrelid = (SELECT oid FROM ledger_tables WHERE table_name = 'socialUploadReservations'::pg_catalog.name)
        AND constraint_catalog.conname = 'social_upload_reservations_object_bytes_check'::pg_catalog.name
        AND pg_catalog.pg_get_expr(constraint_catalog.conbin, constraint_catalog.conrelid) = '("objectBytes" > 0)'::pg_catalog.text
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS constraint_catalog
      WHERE constraint_catalog.conrelid = (SELECT oid FROM ledger_tables WHERE table_name = 'socialUploadReservations'::pg_catalog.name)
        AND constraint_catalog.conname = 'social_upload_reservations_state_check'::pg_catalog.name
        AND pg_catalog.pg_get_expr(constraint_catalog.conbin, constraint_catalog.conrelid) = '((state)::text = ANY ((ARRAY[''put_started''::character varying, ''uploaded''::character varying, ''recorded''::character varying])::text[]))'::pg_catalog.text
    )
    AND NOT EXISTS (
      SELECT 1
      FROM expected_indexes
      LEFT JOIN ledger_tables ON ledger_tables.table_name = expected_indexes.table_name
      LEFT JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.relnamespace = (SELECT namespace_oid FROM media_schema)
       AND index_relation.relname = expected_indexes.index_name
       AND index_relation.relkind = 'i'::pg_catalog."char"
      LEFT JOIN pg_catalog.pg_index AS index_catalog
        ON index_catalog.indexrelid = index_relation.oid
       AND index_catalog.indrelid = ledger_tables.oid
       AND index_catalog.indisvalid AND index_catalog.indisready AND index_catalog.indislive
       AND index_catalog.indisunique = expected_indexes.unique_index
       AND index_catalog.indisprimary = expected_indexes.primary_index
       AND index_catalog.indnkeyatts = expected_indexes.key_count
       AND index_catalog.indnatts = expected_indexes.key_count
       AND index_catalog.indexprs IS NULL AND index_catalog.indpred IS NULL
       AND pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 1, true) = expected_indexes.first_key
       AND (expected_indexes.second_key IS NULL OR pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 2, true) = expected_indexes.second_key)
       AND (expected_indexes.third_key IS NULL OR pg_catalog.pg_get_indexdef(index_catalog.indexrelid, 3, true) = expected_indexes.third_key)
      WHERE index_catalog.indexrelid IS NULL
    )
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_index
         WHERE indrelid = (SELECT oid FROM ledger_tables WHERE table_name = 'socialUploadBudgets'::pg_catalog.name)) = 1
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_index
         WHERE indrelid = (SELECT oid FROM ledger_tables WHERE table_name = 'socialUploadReservations'::pg_catalog.name)) = 4
    AND NOT EXISTS (
      SELECT 1
      FROM expected_policies
      LEFT JOIN ledger_tables ON ledger_tables.table_name = expected_policies.table_name
      LEFT JOIN pg_catalog.pg_policy AS policy_catalog
        ON policy_catalog.polrelid = ledger_tables.oid
       AND policy_catalog.polname = expected_policies.policy_name
       AND policy_catalog.polpermissive
       AND policy_catalog.polcmd = '*'::pg_catalog."char"
       AND policy_catalog.polroles = ARRAY[(SELECT role_oid FROM runtime_role)]::pg_catalog.oid[]
       AND pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid) = 'true'::pg_catalog.text
       AND pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid) = 'true'::pg_catalog.text
      WHERE policy_catalog.oid IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ledger_tables
      WHERE (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy WHERE polrelid = ledger_tables.oid) <> 1
    )
  THEN '${MEDIA_UPLOAD_BUDGET_CONTRACT_VARIANT}'::pg_catalog.text
  ELSE '${MEDIA_UPLOAD_BUDGET_UNAVAILABLE_VARIANT}'::pg_catalog.text END AS contract_variant
  LIMIT 1
`;

/** Backward-compatible name for safe one-row capability checks. */
export const MEDIA_UPLOAD_BUDGET_READINESS_SQL = MEDIA_UPLOAD_BUDGET_AUDIT_SQL;

export function mediaUploadBudgetStatusFromEvidence(
  evidence: MediaUploadBudgetContractEvidence | null,
): MediaUploadBudgetStatus {
  return {
    ready: evidence?.contract_variant === MEDIA_UPLOAD_BUDGET_CONTRACT_VARIANT,
  };
}

export async function inspectMediaUploadBudgetContract(
  database: CirclesDatabase | null,
  deadlineMs = MEDIA_UPLOAD_BUDGET_READINESS_DEADLINE_MS,
): Promise<MediaUploadBudgetStatus> {
  if (!database) return { ready: false };
  try {
    const result = await withOperationDeadline(
      database.$client.query<MediaUploadBudgetContractEvidence>(
        MEDIA_UPLOAD_BUDGET_AUDIT_SQL,
      ),
      deadlineMs,
    );
    return mediaUploadBudgetStatusFromEvidence(result.rows[0] ?? null);
  } catch {
    return { ready: false };
  }
}

export type MediaUploadBudgetStatusDependencies = {
  database?: CirclesDatabase | null;
  getDatabase?: typeof getDb;
  deadlineMs?: number;
};

/**
 * Safe server-only readiness helper. It accepts no DSN, role, schema, account, reservation, or
 * storage-key input and returns only a boolean capability state.
 */
export async function getMediaUploadBudgetStatus(
  dependencies: MediaUploadBudgetStatusDependencies = {},
): Promise<MediaUploadBudgetStatus> {
  const database =
    dependencies.database === undefined
      ? await (dependencies.getDatabase ?? getDb)()
      : dependencies.database;
  return inspectMediaUploadBudgetContract(
    database,
    dependencies.deadlineMs ?? MEDIA_UPLOAD_BUDGET_READINESS_DEADLINE_MS,
  );
}
