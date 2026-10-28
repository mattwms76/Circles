#!/usr/bin/env node
/**
 * Validates the versioned Circles recovery coverage contract and, optionally,
 * a redacted owner-provided external-review attestation. This tool deliberately
 * has no database, provider, GitHub, backup-store, dotenv, or network client.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(moduleDirectory, "..");
export const DEFAULT_MANIFEST = path.join(
  PROJECT_ROOT,
  "operations/recovery/database-recovery-manifest.json",
);
export const MANIFEST_FORMAT = "circles-database-recovery-manifest-v1";
export const EVIDENCE_FORMAT = "circles-database-recovery-evidence-v1";
export const DEFAULT_MAX_EVIDENCE_AGE_HOURS = 48;
const MAX_INPUT_BYTES = 512 * 1024;
const SOURCE_BASE = "e0e83778af66494c60dfdd0511b51b50e3d369a5";
const EXPECTED_TABLE_HASH =
  "c35557b06a15ee4f133425140b7416b5f1a5ad1f3f361e9a06f24abb998aca10";
const EXPECTED_FUNCTION_HASH =
  "cae00b98488bf5a9020b77296a98dd4808cf817374a3da1dab991ed2caa47cfc";
const EXPECTED_POLICY_HASH =
  "cbd2d5f1544bcfd76f5c35603c8115b8bcb533991d2fe66829e33dc3cda2ac63";

const APP_TABLE_SOURCES = Object.freeze({
  users: "drizzle/schema.ts",
  profiles: "drizzle/schema.ts",
  circles: "drizzle/schema.ts",
  memberships: "drizzle/schema.ts",
  posts: "drizzle/schema.ts",
  reactions: "drizzle/schema.ts",
  bookmarks: "drizzle/schema.ts",
  comments: "drizzle/schema.ts",
  conversations: "drizzle/schema.ts",
  conversationParticipants: "drizzle/schema.ts",
  messages: "drizzle/schema.ts",
  follows: "drizzle/schema.ts",
  reports: "drizzle/schema.ts",
  socialUploads: "drizzle/schema.ts",
  socialSeedMarkers: "drizzle/schema.ts",
  _dataMigrations: "drizzle/schema.ts",
  applicationSessions: "drizzle/session-schema.ts",
  streams: "drizzle/live-schema.ts",
  activeHostLeases: "drizzle/live-schema.ts",
  liveViewers: "drizzle/live-schema.ts",
  liveSignals: "drizzle/live-schema.ts",
  liveChat: "drizzle/live-schema.ts",
  activityItems: "drizzle/activity-schema.ts",
  activityPreferences: "drizzle/activity-schema.ts",
  activityCirclePreferences: "drizzle/activity-schema.ts",
  moderationCases: "drizzle/moderation-schema.ts",
  moderationActions: "drizzle/moderation-schema.ts",
});

const EXPECTED_ADMIN_TABLES = Object.freeze([
  "audit",
  "auth_subjects",
  "entity_state",
  "operators",
  "report_reviews",
  "sessions",
  "settings",
  "supabase_sessions",
]);
const EXPECTED_ADMIN_FUNCTIONS = Object.freeze([
  "bind_supabase_session",
  "lookup_supabase_operator",
  "native_append_audit",
  "native_assert_replay",
  "native_circle_home",
  "native_circle_home_read",
  "native_circle_pin",
  "native_membership_approve",
  "native_membership_remove",
  "native_membership_role",
  "native_moderation_resolve",
  "native_profile_correct",
  "native_require_actor",
  "native_stream_force_end",
  "protect_owner_operator",
  "provision_initial_owner",
  "reject_audit_mutation",
  "reject_native_control_lock_mutation",
  "scoped_read_allowed",
  "supabase_session_allowed",
  "touch_updated_at",
]);
const EXPECTED_SOURCE_FILES = Object.freeze([
  ...new Set([
    ...Object.values(APP_TABLE_SOURCES),
    "drizzle/post-publish-receipt-schema.ts",
    "operations/migrations/0001_circles_ops_daily_migration_health.sql",
    "operations/migrations/0002_circles_auth_oauth_pending.sql",
    "operations/migrations/0004_circles_app_integrity.sql",
    "operations/migrations/0014_circles_email_identity.sql",
    "operations/migrations/0015_circles_publish_post_receipts.sql",
    "operations/recovery/README.md",
    "scripts/recovery-continuity.mjs",
  ]),
]);

export class RecoveryManifestError extends Error {
  constructor(code) {
    super(code);
    this.name = "RecoveryManifestError";
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isPlainObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function sortedNames(entries, key) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => entry?.[key]).sort();
}

function sameArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function exactKeys(value, expected) {
  return (
    isPlainObject(value) &&
    sameArray(Object.keys(value).sort(), [...expected].sort())
  );
}

function relativeSourcePath(filename, sourceRoot) {
  if (
    typeof filename !== "string" ||
    !/^[A-Za-z0-9_./-]+$/.test(filename) ||
    filename.startsWith("/") ||
    filename.split("/").includes("..")
  ) {
    return null;
  }
  const root = path.resolve(sourceRoot);
  const resolved = path.resolve(root, filename);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function sourceText(filename, sourceRoot) {
  const resolved = relativeSourcePath(filename, sourceRoot);
  if (!resolved) return null;
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return null;
    return fs.readFileSync(resolved, "utf8");
  } catch {
    return null;
  }
}

function includesTableDeclaration(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`circlesApp\\.table\\(\\s*["']${escaped}["']`).test(source);
}

function checkSourceContains(errors, filename, token, code, sourceRoot) {
  const source = sourceText(filename, sourceRoot);
  if (!source || !source.includes(token)) errors.push(code);
}

function arrayAt(value, property) {
  return Array.isArray(value?.[property]) ? value[property] : null;
}

function tablesForDigest(manifest) {
  const coverage = manifest.coverage;
  return Object.fromEntries(
    [
      "durable_application_state",
      "durable_admin_state",
      "durable_publish_state",
      "operational_history",
      "recreate_empty_after_restore",
    ].map((name) => [name, coverage?.[name]?.tables]),
  );
}

function functionsForDigest(manifest) {
  return manifest.authorization_helpers?.functions;
}

function policiesForDigest(manifest) {
  const policies = manifest.authorization_helpers?.policies;
  return Object.fromEntries(
    [
      "circles_app",
      "circles_admin",
      "circles_auth",
      "circles_ops",
      "circles_publish",
    ].map((name) => [name, policies?.[name]]),
  );
}

/**
 * Validate static recovery coverage against the reviewed source tree and the
 * pinned sanitized-catalog inventory. This is source verification only.
 */
export function validateManifest(manifest, { sourceRoot = PROJECT_ROOT } = {}) {
  const errors = [];
  if (!isPlainObject(manifest)) {
    return { valid: false, errors: ["manifest_not_object"], counts: null };
  }
  if (manifest.format !== MANIFEST_FORMAT)
    errors.push("manifest_format_invalid");
  if (manifest.version !== 1) errors.push("manifest_version_invalid");
  if (manifest.source_evidence?.source_base !== SOURCE_BASE)
    errors.push("source_base_mismatch");
  if (
    manifest.source_evidence?.sanitized_catalog?.source_commit !==
      SOURCE_BASE ||
    typeof manifest.source_evidence?.sanitized_catalog?.source_tree !== "string"
  ) {
    errors.push("sanitized_catalog_provenance_invalid");
  }

  const declaredSourceFiles = manifest.source_evidence?.source_files;
  if (
    !sameArray(
      [...(declaredSourceFiles ?? [])].sort(),
      [...EXPECTED_SOURCE_FILES].sort(),
    )
  )
    errors.push("source_file_inventory_mismatch");
  for (const filename of EXPECTED_SOURCE_FILES) {
    if (!sourceText(filename, sourceRoot))
      errors.push("required_source_file_missing");
  }

  const appTables = arrayAt(
    manifest.coverage?.durable_application_state,
    "tables",
  );
  const expectedAppNames = Object.keys(APP_TABLE_SOURCES).sort();
  if (!sameArray(sortedNames(appTables, "name"), expectedAppNames)) {
    errors.push("durable_application_table_inventory_mismatch");
  } else {
    for (const entry of appTables) {
      if (entry.source !== APP_TABLE_SOURCES[entry.name]) {
        errors.push("durable_application_table_source_mismatch");
        break;
      }
      const source = sourceText(entry.source, sourceRoot);
      if (!source || !includesTableDeclaration(source, entry.name)) {
        errors.push("durable_application_table_not_source_derived");
        break;
      }
    }
  }

  if (
    !sameArray(
      sortedNames(manifest.coverage?.durable_admin_state?.tables, "table_name"),
      [...EXPECTED_ADMIN_TABLES].sort(),
    )
  ) {
    errors.push("durable_admin_table_inventory_mismatch");
  }
  if (
    !sameArray(
      sortedNames(
        manifest.coverage?.durable_publish_state?.tables,
        "table_name",
      ),
      ["postPublishReceipts"],
    ) ||
    manifest.coverage?.durable_publish_state?.source !==
      "operations/migrations/0015_circles_publish_post_receipts.sql"
  ) {
    errors.push("durable_publish_inventory_mismatch");
  }
  if (
    !sameArray(
      sortedNames(manifest.coverage?.operational_history?.tables, "table_name"),
      ["health_runs"],
    )
  ) {
    errors.push("operational_history_inventory_mismatch");
  }
  if (
    !sameArray(
      sortedNames(
        manifest.coverage?.recreate_empty_after_restore?.tables,
        "table_name",
      ),
      ["oauth_pending_states"],
    )
  ) {
    errors.push("oauth_recreate_empty_inventory_mismatch");
  }
  if (
    !sameArray(
      sortedNames(
        manifest.coverage?.optional_durable_when_enabled?.tables,
        "name",
      ),
      ["provider_links"],
    ) ||
    manifest.coverage?.optional_durable_when_enabled?.activation_condition !==
      "email_identity_feature_enabled"
  ) {
    errors.push("optional_identity_inventory_mismatch");
  }

  const roles = manifest.authorization_helpers?.roles;
  if (
    !sameArray(sortedNames(roles, "name"), [
      "circles_admin_native_executor",
      "circles_admin_runtime",
      "circles_app_runtime",
    ])
  ) {
    errors.push("helper_role_inventory_mismatch");
  }
  const functions = manifest.authorization_helpers?.functions;
  if (
    !sameArray(
      sortedNames(functions?.circles_admin, "function_name"),
      [...EXPECTED_ADMIN_FUNCTIONS].sort(),
    ) ||
    !sameArray(sortedNames(functions?.circles_app, "function_name"), [
      "enforce_message_author_authorized",
    ]) ||
    !sameArray(sortedNames(functions?.circles_ops, "function_name"), [
      "run_daily_migration_health",
    ])
  ) {
    errors.push("helper_function_inventory_mismatch");
  }
  const optionalPolicies =
    manifest.authorization_helpers?.policies?.source_only_optional_identity;
  if (
    !sameArray(sortedNames(optionalPolicies, "name"), [
      "circles_identity_provider_links_runtime_insert",
      "circles_identity_provider_links_runtime_select",
    ])
  ) {
    errors.push("optional_identity_policy_inventory_mismatch");
  }

  checkSourceContains(
    errors,
    "operations/migrations/0004_circles_app_integrity.sql",
    "CREATE FUNCTION circles_app.enforce_message_author_authorized()",
    "message_authorization_helper_not_source_derived",
    sourceRoot,
  );
  checkSourceContains(
    errors,
    "operations/migrations/0001_circles_ops_daily_migration_health.sql",
    "CREATE FUNCTION circles_ops.run_daily_migration_health()",
    "health_helper_not_source_derived",
    sourceRoot,
  );
  checkSourceContains(
    errors,
    "operations/migrations/0002_circles_auth_oauth_pending.sql",
    "CREATE TABLE circles_auth.oauth_pending_states",
    "oauth_recreate_source_missing",
    sourceRoot,
  );
  checkSourceContains(
    errors,
    "operations/migrations/0014_circles_email_identity.sql",
    "CREATE TABLE circles_identity.provider_links",
    "optional_identity_source_missing",
    sourceRoot,
  );
  checkSourceContains(
    errors,
    "operations/migrations/0015_circles_publish_post_receipts.sql",
    'CREATE TABLE circles_publish."postPublishReceipts"',
    "publish_receipt_source_missing",
    sourceRoot,
  );

  const declaredHashes = manifest.source_evidence?.catalog_inventory_sha256;
  const computedHashes = {
    tables: digest(tablesForDigest(manifest)),
    functions: digest(functionsForDigest(manifest)),
    policies: digest(policiesForDigest(manifest)),
  };
  if (
    !exactKeys(declaredHashes, ["tables", "functions", "policies"]) ||
    declaredHashes.tables !== EXPECTED_TABLE_HASH ||
    declaredHashes.functions !== EXPECTED_FUNCTION_HASH ||
    declaredHashes.policies !== EXPECTED_POLICY_HASH ||
    declaredHashes.tables !== computedHashes.tables ||
    declaredHashes.functions !== computedHashes.functions ||
    declaredHashes.policies !== computedHashes.policies
  ) {
    errors.push("sanitized_catalog_inventory_mismatch");
  }

  const counts = {
    durable_application_tables: appTables?.length ?? 0,
    durable_admin_tables:
      manifest.coverage?.durable_admin_state?.tables?.length ?? 0,
    durable_publish_tables:
      manifest.coverage?.durable_publish_state?.tables?.length ?? 0,
    operational_history_tables:
      manifest.coverage?.operational_history?.tables?.length ?? 0,
    recreate_empty_tables:
      manifest.coverage?.recreate_empty_after_restore?.tables?.length ?? 0,
    optional_identity_tables:
      manifest.coverage?.optional_durable_when_enabled?.tables?.length ?? 0,
    catalog_helper_functions:
      (functions?.circles_app?.length ?? 0) +
      (functions?.circles_admin?.length ?? 0) +
      (functions?.circles_ops?.length ?? 0),
    catalog_policies:
      (manifest.authorization_helpers?.policies?.circles_app?.length ?? 0) +
      (manifest.authorization_helpers?.policies?.circles_admin?.length ?? 0) +
      (manifest.authorization_helpers?.policies?.circles_auth?.length ?? 0) +
      (manifest.authorization_helpers?.policies?.circles_ops?.length ?? 0) +
      (manifest.authorization_helpers?.policies?.circles_publish?.length ?? 0),
  };
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)].sort(),
    counts,
  };
}

function readTrustedJson(filename) {
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    filename.includes("\0")
  )
    throw new RecoveryManifestError("input_path_invalid");
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch {
    throw new RecoveryManifestError("input_file_unavailable");
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 2 ||
    stat.size > MAX_INPUT_BYTES
  )
    throw new RecoveryManifestError("input_file_not_accepted");
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch {
    throw new RecoveryManifestError("input_json_invalid");
  }
}

export function loadManifest(filename = DEFAULT_MANIFEST) {
  return readTrustedJson(filename);
}

function requireBoolean(value, key, errors) {
  if (value !== true) errors.push(key);
}

function safeOpaqueReference(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
  );
}

function isCurrentIsoTimestamp(value, now, maxAgeHours) {
  if (typeof value !== "string" || value.length > 64) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    return false;
  const ageHours = (now.getTime() - parsed.getTime()) / 3_600_000;
  return ageHours >= -5 / 60 && ageHours <= maxAgeHours;
}

/**
 * Validate a deliberately redacted external-review attestation. A passing
 * result means only that every required owner assertion is present and fresh;
 * the checker cannot independently establish any external fact.
 */
export function validateExternalEvidence(
  evidence,
  {
    now = new Date(),
    maxEvidenceAgeHours = DEFAULT_MAX_EVIDENCE_AGE_HOURS,
  } = {},
) {
  const errors = [];
  if (
    !Number.isInteger(maxEvidenceAgeHours) ||
    maxEvidenceAgeHours < 1 ||
    maxEvidenceAgeHours > 720
  )
    return { valid: false, errors: ["evidence_age_window_invalid"] };
  if (
    !exactKeys(evidence, [
      "format",
      "manifest_version",
      "observed_at",
      "provenance",
      "backup_assets",
      "isolated_restore",
      "media_and_keys",
      "provider",
    ])
  ) {
    return { valid: false, errors: ["evidence_shape_invalid"] };
  }
  if (evidence.format !== EVIDENCE_FORMAT || evidence.manifest_version !== 1)
    errors.push("evidence_version_mismatch");
  if (!isCurrentIsoTimestamp(evidence.observed_at, now, maxEvidenceAgeHours))
    errors.push("evidence_not_current");
  if (
    !exactKeys(evidence.provenance, ["method", "run_reference"]) ||
    evidence.provenance.method !== "authorized_read_only_external_review" ||
    !safeOpaqueReference(evidence.provenance.run_reference)
  ) {
    errors.push("evidence_provenance_invalid");
  }

  if (
    !exactKeys(evidence.backup_assets, [
      "current_successful_run_inspected",
      "encrypted_asset_set_inspected",
      "artifact_integrity_verified",
      "retention_verified",
    ])
  ) {
    errors.push("backup_attestation_shape_invalid");
  } else {
    for (const key of Object.keys(evidence.backup_assets))
      requireBoolean(
        evidence.backup_assets[key],
        `backup_${key}_not_verified`,
        errors,
      );
  }

  if (
    !exactKeys(evidence.isolated_restore, [
      "target_kind",
      "production_target",
      "network_isolated",
      "durable_application_state_verified",
      "durable_admin_state_verified",
      "durable_publish_state_verified",
      "operational_history_verified",
      "oauth_recreated_empty",
      "optional_identity_status",
      "optional_identity_mapping_verified",
    ])
  ) {
    errors.push("restore_attestation_shape_invalid");
  } else {
    if (evidence.isolated_restore.target_kind !== "isolated_postgresql_17")
      errors.push("restore_target_not_postgresql_17");
    if (evidence.isolated_restore.production_target !== false)
      errors.push("restore_target_not_isolated");
    for (const key of [
      "network_isolated",
      "durable_application_state_verified",
      "durable_admin_state_verified",
      "durable_publish_state_verified",
      "operational_history_verified",
      "oauth_recreated_empty",
    ]) {
      requireBoolean(
        evidence.isolated_restore[key],
        `restore_${key}_not_verified`,
        errors,
      );
    }
    if (
      !["not_enabled", "restored"].includes(
        evidence.isolated_restore.optional_identity_status,
      ) ||
      (evidence.isolated_restore.optional_identity_status === "restored" &&
        evidence.isolated_restore.optional_identity_mapping_verified !==
          true) ||
      (evidence.isolated_restore.optional_identity_status === "not_enabled" &&
        evidence.isolated_restore.optional_identity_mapping_verified !== false)
    ) {
      errors.push("optional_identity_attestation_invalid");
    }
  }

  if (
    !exactKeys(evidence.media_and_keys, [
      "media_reference_inventory_verified",
      "media_bytes_continuity_verified",
      "derivation_material_continuity_verified",
      "no_material_embedded",
    ])
  ) {
    errors.push("media_attestation_shape_invalid");
  } else {
    for (const key of Object.keys(evidence.media_and_keys))
      requireBoolean(
        evidence.media_and_keys[key],
        `media_${key}_not_verified`,
        errors,
      );
  }

  if (
    !exactKeys(evidence.provider, [
      "managed_auth_verified",
      "storage_verified",
      "platform_configuration_verified",
      "custom_role_contract_verified",
    ])
  ) {
    errors.push("provider_attestation_shape_invalid");
  } else {
    for (const key of Object.keys(evidence.provider))
      requireBoolean(
        evidence.provider[key],
        `provider_${key}_not_verified`,
        errors,
      );
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

export function inspectRecoveryManifest({
  manifestPath = DEFAULT_MANIFEST,
  evidencePath = null,
  sourceRoot = PROJECT_ROOT,
  now = new Date(),
  maxEvidenceAgeHours = DEFAULT_MAX_EVIDENCE_AGE_HOURS,
} = {}) {
  const manifest = loadManifest(manifestPath);
  const source = validateManifest(manifest, { sourceRoot });
  let external = {
    supplied: false,
    status: "PENDING_EXTERNAL_EVIDENCE",
    errors: ["external_evidence_not_supplied"],
  };
  if (evidencePath !== null) {
    const evidence = readTrustedJson(evidencePath);
    const result = validateExternalEvidence(evidence, {
      now,
      maxEvidenceAgeHours,
    });
    external = {
      supplied: true,
      status: result.valid
        ? "ATTESTATION_COMPLETE_NOT_INDEPENDENTLY_VERIFIED"
        : "ATTESTATION_INVALID",
      errors: result.errors,
    };
  }
  const sourceStatus = source.valid
    ? "SOURCE_CONTRACT_PASS"
    : "SOURCE_CONTRACT_FAIL";
  return {
    format: "circles-database-recovery-check-v1",
    source_status: sourceStatus,
    external_evidence_status: external.status,
    status:
      source.valid &&
      external.status === "ATTESTATION_COMPLETE_NOT_INDEPENDENTLY_VERIFIED"
        ? "SOURCE_PASS_WITH_REDACTED_EXTERNAL_ATTESTATION"
        : source.valid
          ? "SOURCE_PASS_EXTERNAL_RECOVERY_UNVERIFIED"
          : "SOURCE_CONTRACT_INVALID",
    counts: source.counts,
    source_errors: source.errors,
    external_errors: external.errors,
    limitations: [
      "No network, database, provider, backup, GitHub, media, credential, or dotenv access was used.",
      "A complete redacted attestation is not independently verified and is not proof of a live recovery.",
    ],
  };
}

export function parseCliArguments(argv = process.argv.slice(2)) {
  const options = {
    manifestPath: DEFAULT_MANIFEST,
    evidencePath: null,
    requireEvidence: false,
    maxEvidenceAgeHours: DEFAULT_MAX_EVIDENCE_AGE_HOURS,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "--require-evidence") {
      options.requireEvidence = true;
      continue;
    }
    if (
      ["--manifest", "--evidence", "--max-evidence-age-hours"].includes(
        argument,
      )
    ) {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.length === 0)
        throw new RecoveryManifestError("cli_value_required");
      index += 1;
      if (argument === "--manifest") options.manifestPath = value;
      if (argument === "--evidence") options.evidencePath = value;
      if (argument === "--max-evidence-age-hours") {
        if (!/^\d+$/.test(value))
          throw new RecoveryManifestError("cli_age_invalid");
        options.maxEvidenceAgeHours = Number(value);
      }
      continue;
    }
    throw new RecoveryManifestError("cli_argument_invalid");
  }
  if (
    !Number.isInteger(options.maxEvidenceAgeHours) ||
    options.maxEvidenceAgeHours < 1 ||
    options.maxEvidenceAgeHours > 720
  ) {
    throw new RecoveryManifestError("cli_age_invalid");
  }
  return options;
}

export function helpText() {
  return (
    `Circles database recovery manifest checker\n\n` +
    `Usage: node scripts/check-database-recovery-manifest.mjs [--manifest FILE] [--evidence REDACTED_FILE] [--require-evidence] [--max-evidence-age-hours 1..720]\n\n` +
    `The checker validates local source and sanitized-catalog coverage only. It never opens a database, network, provider, GitHub, backup, media, dotenv, or credential source.\n`
  );
}

export function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseCliArguments(argv);
  const output =
    dependencies.output ?? ((value) => process.stdout.write(`${value}\n`));
  if (options.help) {
    output(helpText());
    return 0;
  }
  const report = inspectRecoveryManifest(options);
  output(JSON.stringify(report));
  if (report.source_status !== "SOURCE_CONTRACT_PASS") return 1;
  const externalAttestationComplete =
    report.external_evidence_status ===
    "ATTESTATION_COMPLETE_NOT_INDEPENDENTLY_VERIFIED";
  if (
    (options.requireEvidence || options.evidencePath) &&
    !externalAttestationComplete
  )
    return 1;
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    const code =
      error instanceof RecoveryManifestError ? error.code : "checker_failed";
    process.stdout.write(
      JSON.stringify({ status: "CHECKER_FAILED", code }) + "\n",
    );
    process.exitCode = 1;
  }
}
