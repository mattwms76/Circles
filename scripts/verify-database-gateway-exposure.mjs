import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";

export const DB13_ID = "DB-13";
export const PROJECT_REF = "vvclcsqletcxzoaayqzq";
export const MANAGEMENT_API_TOKEN_ENV = "CIRCLES_SUPABASE_MANAGEMENT_API_TOKEN";
export const MANAGEMENT_API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/postgrest`;
export const MANAGEMENT_API_TIMEOUT_MS = 5_000;
export const MAX_RESPONSE_BYTES = 65_536;
export const MAX_EXPOSED_SCHEMAS = 32;

const EVIDENCE_VERSION = 1;
const ALLOWED_EVIDENCE_SOURCES = new Set([
  "supabase_management_api",
  "supabase_dashboard_data_api_settings",
  "supabase_management_api_and_dashboard",
]);
const REQUIRED_POSTGREST_FIELDS = [
  "db_schema",
  "max_rows",
  "db_extra_search_path",
  "db_pool",
  "db_pool_acquisition_timeout",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInteger(value) {
  return Number.isInteger(value) && Number.isSafeInteger(value);
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    !Number.isNaN(Date.parse(value))
  );
}

function safeSchemaName(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 63 &&
    /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)
  );
}

function safeString(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength;
}

function isProtectedCirclesSchema(schemaName) {
  return schemaName.toLowerCase().startsWith("circles_");
}

function parseSchemaList(value) {
  if (!safeString(value, 4_096)) return null;
  const schemas = value.split(",").map((schema) => schema.trim());
  if (
    schemas.length === 0 ||
    schemas.length > MAX_EXPOSED_SCHEMAS ||
    schemas.some((schema) => !safeSchemaName(schema))
  ) {
    return null;
  }
  const uniqueSchemas = [...new Set(schemas)];
  if (uniqueSchemas.length !== schemas.length) return null;
  return uniqueSchemas;
}

/**
 * Reduces a provider PostgREST response to the documented fields this verifier
 * needs. Unknown response fields are deliberately ignored and never reported.
 */
export function normalizePostgrestResponse(value) {
  if (!isObject(value)) return null;
  if (REQUIRED_POSTGREST_FIELDS.some((field) => !(field in value))) return null;
  const exposedSchemas = parseSchemaList(value.db_schema);
  if (
    !exposedSchemas ||
    !isInteger(value.max_rows) ||
    !safeString(value.db_extra_search_path, 4_096) ||
    !isInteger(value.db_pool) ||
    !isInteger(value.db_pool_acquisition_timeout)
  ) {
    return null;
  }
  return {
    exposed_schemas: exposedSchemas,
  };
}

/**
 * Validates the versioned, reviewable offline evidence envelope. It intentionally
 * accepts no unproven pg_catalog setting as a substitute for provider evidence.
 */
export function normalizeAuthoritativeEvidence(value) {
  if (!isObject(value) || value.evidence_version !== EVIDENCE_VERSION)
    return null;
  if (!isObject(value.provenance) || !isObject(value.postgrest)) return null;

  const provenance = value.provenance;
  if (
    provenance.provider !== "supabase" ||
    provenance.project_ref !== PROJECT_REF ||
    !ALLOWED_EVIDENCE_SOURCES.has(provenance.source) ||
    provenance.reviewed !== true ||
    !validTimestamp(provenance.observed_at) ||
    typeof value.auto_expose_new_tables !== "boolean"
  ) {
    return null;
  }

  const postgrest = normalizePostgrestResponse(value.postgrest);
  if (!postgrest) return null;

  return {
    kind: "authoritative_settings_file",
    provenance: {
      provider: "supabase",
      source: provenance.source,
      project_ref: PROJECT_REF,
      observed_at: new Date(provenance.observed_at).toISOString(),
      reviewed: true,
    },
    ...postgrest,
    auto_expose_new_tables: value.auto_expose_new_tables,
  };
}

function unavailableReport(sourceKind, reason) {
  return {
    report_version: 1,
    id: DB13_ID,
    status: "unknown",
    target: {
      provider: "supabase",
      project_ref: PROJECT_REF,
      protected_schema_prefix: "circles_",
    },
    source: {
      kind: sourceKind,
      status: "unavailable",
    },
    checks: [
      {
        name: "provider_settings_evidence",
        status: "unknown",
        reason,
      },
    ],
    findings: ["No provider gateway exposure conclusion was made."],
  };
}

/**
 * Produces a redacted PASS/FAIL report from validated evidence. Both a private
 * circles_* exposed schema and enabled automatic exposure are review failures.
 */
export function evaluateGatewayExposure(evidence) {
  if (
    !evidence ||
    !Array.isArray(evidence.exposed_schemas) ||
    typeof evidence.auto_expose_new_tables !== "boolean"
  ) {
    return unavailableReport("unknown", "invalid_evidence");
  }

  const protectedSchemas = evidence.exposed_schemas.filter(
    isProtectedCirclesSchema,
  );
  const exposedStatus = protectedSchemas.length === 0 ? "pass" : "fail";
  const automaticExposureStatus = evidence.auto_expose_new_tables
    ? "fail"
    : "pass";
  const status =
    exposedStatus === "fail" || automaticExposureStatus === "fail"
      ? "fail"
      : "pass";

  return {
    report_version: 1,
    id: DB13_ID,
    status,
    target: {
      provider: "supabase",
      project_ref: PROJECT_REF,
      protected_schema_prefix: "circles_",
    },
    source: {
      kind: evidence.kind,
      status: "validated",
      provenance: evidence.provenance ?? null,
    },
    checks: [
      {
        name: "provider_postgrest_response_shape",
        status: "pass",
        required_fields: [...REQUIRED_POSTGREST_FIELDS],
      },
      {
        name: "exposed_circles_schemas",
        status: exposedStatus,
        exposed_schema_count: evidence.exposed_schemas.length,
        exposed_circles_schemas: protectedSchemas,
      },
      {
        name: "automatic_exposure_for_new_tables",
        status: automaticExposureStatus,
        enabled: evidence.auto_expose_new_tables,
      },
    ],
    findings:
      status === "pass"
        ? [
            "No circles_* schema is exposed by the validated Data API configuration, and automatic exposure for new tables is disabled.",
          ]
        : [
            "Gateway configuration requires review before private-schema exposure can be considered controlled.",
          ],
  };
}

async function readBoundedJson(response) {
  const contentLength = response.headers?.get?.("content-length");
  if (
    contentLength !== null &&
    contentLength !== undefined &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    return null;
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Performs exactly one GET against the documented, project-pinned Management
 * API endpoint. The caller supplies the protected token only in memory.
 */
export async function fetchManagementApiPostgrestEvidence({
  token,
  fetchImpl = fetch,
} = {}) {
  if (typeof token !== "string" || token.length === 0 || token.length > 4_096)
    return null;

  let response;
  try {
    response = await fetchImpl(MANAGEMENT_API_URL, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(MANAGEMENT_API_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (!response || response.status !== 200) return null;
  const raw = await readBoundedJson(response);
  const postgrest = normalizePostgrestResponse(raw);
  if (!postgrest) return null;

  return {
    kind: "management_api",
    provenance: {
      provider: "supabase",
      source: "supabase_management_api",
      project_ref: PROJECT_REF,
      observed_at: null,
      reviewed: false,
    },
    ...postgrest,
    // The documented GET response does not attest this Dashboard setting.
    auto_expose_new_tables: null,
  };
}

export function evaluateManagementApiEvidence(evidence) {
  if (!evidence)
    return unavailableReport("management_api", "management_api_unavailable");

  const protectedSchemas = evidence.exposed_schemas.filter(
    isProtectedCirclesSchema,
  );
  if (protectedSchemas.length > 0) {
    return {
      ...evaluateGatewayExposure({
        ...evidence,
        auto_expose_new_tables: false,
      }),
      source: {
        kind: "management_api",
        status: "validated_but_incomplete",
        provenance: evidence.provenance,
      },
      checks: [
        {
          name: "provider_postgrest_response_shape",
          status: "pass",
          required_fields: [...REQUIRED_POSTGREST_FIELDS],
        },
        {
          name: "exposed_circles_schemas",
          status: "fail",
          exposed_schema_count: evidence.exposed_schemas.length,
          exposed_circles_schemas: protectedSchemas,
        },
        {
          name: "automatic_exposure_for_new_tables",
          status: "unknown",
          reason: "not_returned_by_documented_management_api_response",
        },
      ],
    };
  }

  return {
    report_version: 1,
    id: DB13_ID,
    status: "unknown",
    target: {
      provider: "supabase",
      project_ref: PROJECT_REF,
      protected_schema_prefix: "circles_",
    },
    source: {
      kind: "management_api",
      status: "validated_but_incomplete",
      provenance: evidence.provenance,
    },
    checks: [
      {
        name: "provider_postgrest_response_shape",
        status: "pass",
        required_fields: [...REQUIRED_POSTGREST_FIELDS],
      },
      {
        name: "exposed_circles_schemas",
        status: "pass",
        exposed_schema_count: evidence.exposed_schemas.length,
        exposed_circles_schemas: [],
      },
      {
        name: "automatic_exposure_for_new_tables",
        status: "unknown",
        reason: "not_returned_by_documented_management_api_response",
      },
    ],
    findings: [
      "The Management API response did not contain automatic-exposure evidence, so no full gateway exposure conclusion was made.",
    ],
  };
}

export function parseArgs(argv) {
  const options = { settingsFile: null, managementApi: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
    } else if (argument === "--settings-file") {
      const value = argv[index + 1];
      if (!value || options.settingsFile) throw new Error("invalid_arguments");
      options.settingsFile = value;
      index += 1;
    } else if (argument === "--management-api") {
      if (options.managementApi) throw new Error("invalid_arguments");
      options.managementApi = true;
    } else {
      throw new Error("invalid_arguments");
    }
  }
  if (!options.help && options.settingsFile === null && !options.managementApi)
    throw new Error("missing_source");
  if (options.settingsFile !== null && options.managementApi)
    throw new Error("ambiguous_source");
  return options;
}

export async function runGatewayExposureVerification(
  options,
  dependencies = {},
) {
  if (options.settingsFile) {
    let parsed;
    try {
      const contents = await (dependencies.readFile ?? readFile)(
        resolve(options.settingsFile),
        "utf8",
      );
      if (Buffer.byteLength(contents, "utf8") > MAX_RESPONSE_BYTES) {
        return unavailableReport(
          "authoritative_settings_file",
          "settings_evidence_too_large",
        );
      }
      parsed = JSON.parse(contents);
    } catch {
      return unavailableReport(
        "authoritative_settings_file",
        "settings_evidence_unavailable",
      );
    }
    const evidence = normalizeAuthoritativeEvidence(parsed);
    if (!evidence)
      return unavailableReport(
        "authoritative_settings_file",
        "settings_evidence_invalid",
      );
    return evaluateGatewayExposure(evidence);
  }

  const token = (dependencies.env ?? process.env)[MANAGEMENT_API_TOKEN_ENV];
  const evidence = await fetchManagementApiPostgrestEvidence({
    token,
    fetchImpl: dependencies.fetchImpl ?? fetch,
  });
  return evaluateManagementApiEvidence(evidence);
}

function usage() {
  return [
    "Usage: node scripts/verify-database-gateway-exposure.mjs (--settings-file <path> | --management-api)",
    "",
    "--settings-file accepts only the versioned DB-13 reviewed evidence envelope.",
    "--management-api makes one bounded read-only request to the pinned provider endpoint",
    `and reads its token only from ${MANAGEMENT_API_TOKEN_ENV}.`,
    "Output is a redacted JSON PASS, FAIL, or UNKNOWN report; it never prints tokens, URLs, headers, or raw provider settings.",
  ].join("\n");
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch {
    console.error(
      "Gateway exposure verifier arguments are invalid. Use --help.",
    );
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const report = await runGatewayExposureVerification(options);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode =
    report.status === "pass" ? 0 : report.status === "fail" ? 1 : 2;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
