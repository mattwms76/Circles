import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";

export const DB13_ID = "DB-13";
export const PROJECT_REF = "vvclcsqletcxzoaayqzq";
export const CAPTURE_VERSION = 1;
export const ATTESTED_CAPTURE_NOT_INDEPENDENTLY_AUTHENTICATED =
  "ATTESTED_CAPTURE_NOT_INDEPENDENTLY_AUTHENTICATED";
export const MAX_CAPTURE_AGE_MS = 15 * 60 * 1_000;
export const MAX_RESPONSE_BYTES = 65_536;
export const MAX_EXPOSED_SCHEMAS = 32;
export const MANAGEMENT_API_TIMEOUT_MS = 5_000;
export const MANAGEMENT_API_TOKEN_ENV = "CIRCLES_SUPABASE_MANAGEMENT_API_TOKEN";
export const PUBLIC_GATEWAY_KEY_ENV = "CIRCLES_DB13_PUBLIC_ANON_KEY";
export const MANAGEMENT_API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/postgrest`;
export const PUBLIC_GATEWAY_URL = `https://${PROJECT_REF}.supabase.co/rest/v1`;
export const DASHBOARD_SETTINGS_ORIGIN = "https://supabase.com";
export const DASHBOARD_SETTINGS_PATH = `/dashboard/project/${PROJECT_REF}/settings/api`;
export const DASHBOARD_AUTHENTICATION_ORIGIN =
  "supabase_authenticated_owner_dashboard_session";
export const MANAGEMENT_AUTHENTICATION_ORIGIN =
  "environment:CIRCLES_SUPABASE_MANAGEMENT_API_TOKEN";
export const DASHBOARD_CAPTURE_SOURCE_VERSION = "dashboard_api_settings_v1";
export const MANAGEMENT_CAPTURE_SOURCE_VERSION =
  "management_postgrest_response_v1";
export const KNOWN_PRIVATE_PROBE_SCHEMAS = Object.freeze([
  "circles_app",
  "circles_admin",
  "circles_auth",
  "circles_ops",
  "circles_publish",
  "circles_identity",
  "private",
]);

const REQUIRED_POSTGREST_FIELDS = [
  "db_schema",
  "max_rows",
  "db_extra_search_path",
  "db_pool",
  "db_pool_acquisition_timeout",
];
const PROBE_RELATION = "__circles_db13_schema_probe__";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeString(value, maxLength, minLength = 0) {
  return (
    typeof value === "string" &&
    value.length >= minLength &&
    value.length <= maxLength
  );
}

function isSafeInteger(value) {
  return Number.isSafeInteger(value);
}

function normalizeTimestamp(value) {
  if (!safeString(value, 64, 1)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
}

function isFreshTimestamp(timestamp, now) {
  const observedAt = Date.parse(timestamp);
  const currentTime = now.getTime();
  return (
    Number.isFinite(observedAt) &&
    observedAt <= currentTime + 60_000 &&
    observedAt >= currentTime - MAX_CAPTURE_AGE_MS
  );
}

function safeSchemaName(value) {
  return safeString(value, 63, 1) && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value);
}

function normalizeSchemaArray(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_EXPOSED_SCHEMAS
  )
    return null;
  if (value.some((schema) => !safeSchemaName(schema))) return null;
  const normalized = value.map((schema) => schema.trim());
  if (normalized.some((schema) => schema.length === 0)) return null;
  const lowercase = normalized.map((schema) => schema.toLowerCase());
  if (new Set(lowercase).size !== normalized.length) return null;
  return normalized;
}

function normalizePostgrestSchemaList(value) {
  if (!safeString(value, 4_096, 1)) return null;
  return normalizeSchemaArray(value.split(",").map((schema) => schema.trim()));
}

function isProtectedSchema(schema) {
  return schema.toLowerCase().startsWith("circles_");
}

function reportTarget() {
  return {
    provider: "supabase",
    project_ref: PROJECT_REF,
    protected_schema_prefix: "circles_",
  };
}

function unavailableReport(sourceKind, reason) {
  return {
    report_version: 1,
    id: DB13_ID,
    status: "unknown",
    target: reportTarget(),
    source: {
      kind: sourceKind,
      status: "unavailable",
    },
    checks: [
      {
        name: "authoritative_provider_settings_capture",
        status: "unknown",
        reason,
      },
    ],
    findings: ["No provider gateway exposure conclusion was made."],
  };
}

function summarizeExposure(capture) {
  const exposedPrivateSchemas =
    capture.settings.exposed_schemas.filter(isProtectedSchema);
  return {
    exposedPrivateSchemas,
    exposedStatus: exposedPrivateSchemas.length === 0 ? "pass" : "fail",
    automaticStatus: capture.settings.auto_expose_new_tables ? "fail" : "pass",
  };
}

function defaultProbeCheck() {
  return {
    name: "settings_to_gateway_schema_probes",
    status: "not_run",
    scope:
      "A 406/PGRST106 schema rejection is an effective gateway observation only; it does not attest the automatic-exposure control.",
  };
}

/**
 * Normalizes a complete, sanitized local attestation of Dashboard settings.
 * The finite shape pins provider, project, source contract version, fresh
 * capture time, HTTPS origin/path, HTTP result, and an authentication claim.
 * A JSON literal cannot independently authenticate that claim, so this result
 * must never close DB-13 on its own.
 */
export function normalizeDashboardSettingsCapture(
  value,
  { now = new Date() } = {},
) {
  if (!isObject(value) || value.capture_version !== CAPTURE_VERSION)
    return null;
  if (!isObject(value.source) || !isObject(value.source.transport)) return null;
  if (!isObject(value.settings)) return null;

  const source = value.source;
  const transport = source.transport;
  const observedAt = normalizeTimestamp(source.observed_at);
  const exposedSchemas = normalizeSchemaArray(value.settings.exposed_schemas);

  if (
    source.provider !== "supabase" ||
    source.kind !== "authenticated_dashboard_settings" ||
    source.source_version !== DASHBOARD_CAPTURE_SOURCE_VERSION ||
    source.project_ref !== PROJECT_REF ||
    !observedAt ||
    !isFreshTimestamp(observedAt, now) ||
    transport.protocol !== "https" ||
    transport.request_method !== "GET" ||
    transport.origin !== DASHBOARD_SETTINGS_ORIGIN ||
    transport.path !== DASHBOARD_SETTINGS_PATH ||
    transport.response_status !== 200 ||
    transport.authentication_origin !== DASHBOARD_AUTHENTICATION_ORIGIN ||
    !exposedSchemas ||
    typeof value.settings.auto_expose_new_tables !== "boolean"
  ) {
    return null;
  }

  return {
    kind: "attested_dashboard_settings_capture",
    source: {
      provider: "supabase",
      claimed_kind: source.kind,
      source_version: source.source_version,
      project_ref: PROJECT_REF,
      observed_at: observedAt,
      transport: {
        protocol: "https",
        request_method: "GET",
        origin: DASHBOARD_SETTINGS_ORIGIN,
        path: DASHBOARD_SETTINGS_PATH,
        response_status: 200,
        claimed_authentication_origin: DASHBOARD_AUTHENTICATION_ORIGIN,
      },
    },
    settings: {
      exposed_schemas: exposedSchemas,
      auto_expose_new_tables: value.settings.auto_expose_new_tables,
    },
  };
}

/**
 * Normalizes only the documented Management API PostgREST response. Its shape
 * does not contain the Dashboard automatic-exposure setting, so callers must
 * preserve that setting as unknown.
 */
export function normalizeManagementApiPostgrestResponse(value) {
  if (!isObject(value)) return null;
  if (REQUIRED_POSTGREST_FIELDS.some((field) => !(field in value))) return null;
  const exposedSchemas = normalizePostgrestSchemaList(value.db_schema);
  if (
    !exposedSchemas ||
    !isSafeInteger(value.max_rows) ||
    !safeString(value.db_extra_search_path, 4_096) ||
    !isSafeInteger(value.db_pool) ||
    !isSafeInteger(value.db_pool_acquisition_timeout)
  ) {
    return null;
  }
  return { exposed_schemas: exposedSchemas };
}

async function readBoundedJson(response) {
  const contentLength = response?.headers?.get?.("content-length");
  if (
    contentLength !== null &&
    contentLength !== undefined &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    return null;
  }

  let body;
  try {
    body = await response.text();
  } catch {
    return null;
  }
  if (
    !safeString(body, MAX_RESPONSE_BYTES) ||
    Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES
  )
    return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Makes one project-pinned, redirect-refusing Management API request. The token
 * stays in memory and the returned object intentionally has no automatic-toggle
 * value because this response cannot prove it.
 */
export async function fetchManagementApiCapture({
  token,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  if (!safeString(token, 4_096, 1)) return null;

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
  const postgrest = normalizeManagementApiPostgrestResponse(raw);
  if (!postgrest) return null;

  return {
    kind: "management_api_postgrest_partial",
    source: {
      provider: "supabase",
      kind: "management_api_postgrest",
      source_version: MANAGEMENT_CAPTURE_SOURCE_VERSION,
      project_ref: PROJECT_REF,
      observed_at: now.toISOString(),
      transport: {
        protocol: "https",
        request_method: "GET",
        authentication_origin: MANAGEMENT_AUTHENTICATION_ORIGIN,
      },
    },
    settings: {
      exposed_schemas: postgrest.exposed_schemas,
      auto_expose_new_tables: null,
    },
  };
}

export function settingsFingerprint(capture) {
  if (
    !capture ||
    !capture.source ||
    !capture.settings ||
    !Array.isArray(capture.settings.exposed_schemas)
  ) {
    return null;
  }
  const canonical = JSON.stringify({
    project_ref: capture.source.project_ref,
    source_version: capture.source.source_version,
    observed_at: capture.source.observed_at,
    exposed_schemas: capture.settings.exposed_schemas,
    auto_expose_new_tables: capture.settings.auto_expose_new_tables,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function evaluateDashboardSettingsCapture(capture) {
  if (
    !capture ||
    capture.kind !== "attested_dashboard_settings_capture" ||
    typeof capture.settings?.auto_expose_new_tables !== "boolean"
  ) {
    return unavailableReport(
      "authenticated_dashboard_settings",
      "invalid_capture",
    );
  }

  const exposure = summarizeExposure(capture);

  return {
    report_version: 1,
    id: DB13_ID,
    status: "unknown",
    reason: ATTESTED_CAPTURE_NOT_INDEPENDENTLY_AUTHENTICATED,
    target: reportTarget(),
    source: {
      kind: "local_dashboard_settings_attestation",
      status: "syntactically_validated_not_independently_authenticated",
      observed_at: capture.source.observed_at,
      source_version: capture.source.source_version,
      claimed_authentication_origin: DASHBOARD_AUTHENTICATION_ORIGIN,
    },
    checks: [
      {
        name: "local_capture_syntax",
        status: "pass",
        capture_version: CAPTURE_VERSION,
        source_time: capture.source.observed_at,
        source_version: capture.source.source_version,
      },
      {
        name: "provider_authentication",
        status: "unknown",
        reason: ATTESTED_CAPTURE_NOT_INDEPENDENTLY_AUTHENTICATED,
        scope:
          "Local provenance fields are claims, not independent proof of an authenticated provider Dashboard or API response.",
      },
      {
        name: "attested_exposed_circles_schemas",
        status: "unknown",
        attested_value_status: exposure.exposedStatus,
        exposed_schema_count: capture.settings.exposed_schemas.length,
        exposed_circles_schemas: exposure.exposedPrivateSchemas,
      },
      {
        name: "attested_automatic_exposure_for_new_tables",
        status: "unknown",
        attested_value_status: exposure.automaticStatus,
        attested_enabled: capture.settings.auto_expose_new_tables,
      },
      defaultProbeCheck(),
    ],
    findings: [
      "The local capture is syntactically valid but does not independently authenticate a provider settings response.",
      "Attested schema and automatic-exposure values are retained only for review and consistency diagnostics; DB-13 remains unknown.",
    ],
  };
}

export function evaluateManagementApiCapture(capture) {
  if (
    !capture ||
    capture.kind !== "management_api_postgrest_partial" ||
    !Array.isArray(capture.settings?.exposed_schemas) ||
    capture.settings.auto_expose_new_tables !== null
  ) {
    return unavailableReport(
      "management_api_postgrest",
      "management_api_unavailable",
    );
  }

  const exposedPrivateSchemas =
    capture.settings.exposed_schemas.filter(isProtectedSchema);
  const exposedStatus = exposedPrivateSchemas.length === 0 ? "pass" : "fail";
  const status = exposedStatus === "fail" ? "fail" : "unknown";

  return {
    report_version: 1,
    id: DB13_ID,
    status,
    target: reportTarget(),
    source: {
      kind: "management_api_postgrest",
      status: "validated_but_partial",
      observed_at: capture.source.observed_at,
      source_version: capture.source.source_version,
      authentication_origin: MANAGEMENT_AUTHENTICATION_ORIGIN,
    },
    checks: [
      {
        name: "management_api_postgrest_response",
        status: "pass",
        required_fields: [...REQUIRED_POSTGREST_FIELDS],
      },
      {
        name: "exposed_circles_schemas",
        status: exposedStatus,
        exposed_schema_count: capture.settings.exposed_schemas.length,
        exposed_circles_schemas: exposedPrivateSchemas,
      },
      {
        name: "automatic_exposure_for_new_tables",
        status: "unknown",
        reason: "not_returned_by_documented_management_api_response",
      },
      defaultProbeCheck(),
    ],
    findings:
      status === "fail"
        ? [
            "The Management API named a circles_* schema; automatic exposure remains separately unknown.",
          ]
        : [
            "The Management API did not attest automatic exposure, so no complete gateway exposure conclusion was made.",
          ],
  };
}

export function createGatewayProbePlan(capture) {
  const fingerprint = settingsFingerprint(capture);
  if (!fingerprint) return null;
  return {
    probe_version: 1,
    settings_fingerprint: fingerprint,
    project_ref: PROJECT_REF,
    schemas: [...KNOWN_PRIVATE_PROBE_SCHEMAS],
  };
}

function classifyGatewaySchemaResponse(response, body) {
  if (response.status === 406 && isObject(body) && body.code === "PGRST106") {
    return "rejected";
  }
  if (response.status >= 200 && response.status <= 599) return "not_rejected";
  return "unknown";
}

/**
 * Runs bounded zero-row public-gateway schema probes against a fixed project
 * URL. They validate effective schema rejection only. They never read a real
 * relation, never accept a caller URL, and never turn a missing toggle into a
 * known false value.
 */
export async function executeGatewaySchemaProbes(
  capture,
  { publicAnonKey, fetchImpl = fetch, now = new Date() } = {},
) {
  const plan = createGatewayProbePlan(capture);
  if (!plan || !safeString(publicAnonKey, 4_096, 1)) return null;

  const checks = [];
  for (const schema of plan.schemas) {
    let response;
    let body = null;
    try {
      response = await fetchImpl(
        `${PUBLIC_GATEWAY_URL}/${PROBE_RELATION}?limit=0`,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            apikey: publicAnonKey,
            "accept-profile": schema,
          },
          redirect: "error",
          signal: AbortSignal.timeout(MANAGEMENT_API_TIMEOUT_MS),
        },
      );
      if (!response) {
        checks.push({ schema, status: "unknown" });
        continue;
      }
      body = await readBoundedJson(response);
    } catch {
      checks.push({ schema, status: "unknown" });
      continue;
    }

    checks.push({
      schema,
      status: classifyGatewaySchemaResponse(response, body),
    });
  }

  return {
    probe_version: 1,
    settings_fingerprint: plan.settings_fingerprint,
    project_ref: PROJECT_REF,
    observed_at: now.toISOString(),
    checks,
  };
}

/**
 * Adds independent effective-route probe evidence to a settings result. A probe
 * mismatch fails closed; all PGRST106 rejections preserve an UNKNOWN management
 * response because they cannot prove automatic exposure.
 */
export function evaluateSettingsToGatewayProbes(capture, report, probes) {
  const fingerprint = settingsFingerprint(capture);
  if (!fingerprint || !report || !Array.isArray(report.checks)) {
    return unavailableReport(
      "settings_to_gateway_probe",
      "invalid_probe_binding",
    );
  }

  const replaceProbeCheck = (probeCheck) => ({
    ...report,
    checks: report.checks.map((check) =>
      check.name === "settings_to_gateway_schema_probes" ? probeCheck : check,
    ),
  });

  if (
    !probes ||
    probes.probe_version !== 1 ||
    probes.project_ref !== PROJECT_REF ||
    probes.settings_fingerprint !== fingerprint ||
    !Array.isArray(probes.checks) ||
    probes.checks.length !== KNOWN_PRIVATE_PROBE_SCHEMAS.length ||
    probes.checks.some(
      (check, index) =>
        !isObject(check) ||
        check.schema !== KNOWN_PRIVATE_PROBE_SCHEMAS[index] ||
        !["rejected", "not_rejected", "unknown"].includes(check.status),
    )
  ) {
    const bound = replaceProbeCheck({
      name: "settings_to_gateway_schema_probes",
      status: "unknown",
      reason: "probe_evidence_untrusted_or_not_bound_to_settings_capture",
    });
    return {
      ...bound,
      status: bound.status === "fail" ? "fail" : "unknown",
      findings: [
        ...bound.findings,
        "The supplied gateway-probe observations were not accepted as bound evidence.",
      ],
    };
  }

  const configuredSchemas = new Set(capture.settings.exposed_schemas);
  const notRejectedSchemas = probes.checks
    .filter((check) => check.status === "not_rejected")
    .map((check) => check.schema);
  const unknownCount = probes.checks.filter(
    (check) => check.status === "unknown",
  ).length;
  const mismatchedSchemas = probes.checks
    .filter((check) => {
      const expectedRejection = !configuredSchemas.has(check.schema);
      return (
        check.status !== "unknown" &&
        (check.status === "rejected") !== expectedRejection
      );
    })
    .map((check) => check.schema);
  const probeStatus =
    notRejectedSchemas.length > 0 || mismatchedSchemas.length > 0
      ? "fail"
      : unknownCount > 0
        ? "unknown"
        : "pass";
  const bound = replaceProbeCheck({
    name: "settings_to_gateway_schema_probes",
    status: probeStatus,
    rejected_schema_count: probes.checks.filter(
      (check) => check.status === "rejected",
    ).length,
    non_rejected_schemas: notRejectedSchemas,
    unknown_schema_count: unknownCount,
    mismatch_schemas: mismatchedSchemas,
    scope:
      "PGRST106 confirms only effective current schema rejection; it never establishes the automatic-exposure setting.",
  });

  const isUnauthenticatedLocalAttestation =
    bound.reason === ATTESTED_CAPTURE_NOT_INDEPENDENTLY_AUTHENTICATED;
  const status = isUnauthenticatedLocalAttestation
    ? "unknown"
    : bound.status === "fail" || probeStatus === "fail"
      ? "fail"
      : probeStatus === "unknown"
        ? "unknown"
        : bound.status;
  const findings = [...bound.findings];
  if (probeStatus === "fail") {
    findings.push(
      "Gateway probe observations conflict with the intended private-schema exposure boundary.",
    );
  } else if (probeStatus === "unknown") {
    findings.push(
      "One or more gateway schema probes were inconclusive; no automatic-exposure inference was made.",
    );
  }
  if (isUnauthenticatedLocalAttestation) {
    findings.push(
      "Gateway-probe consistency cannot independently authenticate the supplied local settings attestation or close DB-13.",
    );
  }
  return { ...bound, status, findings };
}

export function parseArgs(argv) {
  const options = {
    captureFile: null,
    managementApi: false,
    publicProbe: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
    } else if (argument === "--capture-file") {
      const value = argv[index + 1];
      if (!value || options.captureFile) throw new Error("invalid_arguments");
      options.captureFile = value;
      index += 1;
    } else if (argument === "--management-api") {
      if (options.managementApi) throw new Error("invalid_arguments");
      options.managementApi = true;
    } else if (argument === "--public-probe") {
      if (options.publicProbe) throw new Error("invalid_arguments");
      options.publicProbe = true;
    } else {
      throw new Error("invalid_arguments");
    }
  }
  if (!options.help && options.captureFile === null && !options.managementApi)
    throw new Error("missing_source");
  if (options.captureFile !== null && options.managementApi)
    throw new Error("ambiguous_source");
  return options;
}

export async function runGatewayCaptureVerification(
  options,
  dependencies = {},
) {
  const now = dependencies.now ?? new Date();
  const env = dependencies.env ?? process.env;
  let capture;
  let report;

  if (options.captureFile) {
    let parsed;
    try {
      const contents = await (dependencies.readFile ?? readFile)(
        resolve(options.captureFile),
        "utf8",
      );
      if (!safeString(contents, MAX_RESPONSE_BYTES)) {
        return unavailableReport(
          "authenticated_dashboard_settings",
          "settings_capture_too_large",
        );
      }
      parsed = JSON.parse(contents);
    } catch {
      return unavailableReport(
        "authenticated_dashboard_settings",
        "settings_capture_unavailable",
      );
    }
    capture = normalizeDashboardSettingsCapture(parsed, { now });
    if (!capture)
      return unavailableReport(
        "authenticated_dashboard_settings",
        "settings_capture_invalid_untrusted_or_stale",
      );
    report = evaluateDashboardSettingsCapture(capture);
  } else {
    capture = await fetchManagementApiCapture({
      token: env[MANAGEMENT_API_TOKEN_ENV],
      fetchImpl: dependencies.fetchImpl ?? fetch,
      now,
    });
    report = evaluateManagementApiCapture(capture);
  }

  if (!options.publicProbe) return report;
  const probes = await executeGatewaySchemaProbes(capture, {
    publicAnonKey: env[PUBLIC_GATEWAY_KEY_ENV],
    fetchImpl: dependencies.fetchImpl ?? fetch,
    now,
  });
  return evaluateSettingsToGatewayProbes(capture, report, probes);
}

function usage() {
  return [
    "Usage: node scripts/remaining-db13-gateway-capture.mjs (--capture-file <private-path> | --management-api) [--public-probe]",
    "",
    "--capture-file accepts only a fresh local Dashboard settings attestation with",
    "pinned project, HTTPS origin/path, claimed owner-session authentication, exposed",
    "schemas, and the automatic-exposure Boolean; it remains UNKNOWN and cannot close DB-13.",
    "--management-api performs one bounded, read-only GET to the project-pinned",
    `Management API and reads its token only from ${MANAGEMENT_API_TOKEN_ENV}.`,
    `--public-probe is optional and reads only ${PUBLIC_GATEWAY_KEY_ENV}; it performs`,
    "zero-row schema probes against the pinned public gateway and cannot establish",
    "the automatic-exposure setting.",
    "Output is redacted JSON and never prints credentials, request URLs, headers, or raw provider settings.",
  ].join("\n");
}

export function exitCodeForReport(report) {
  return report?.status === "pass" ? 0 : report?.status === "fail" ? 1 : 2;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch {
    console.error("DB-13 gateway capture arguments are invalid. Use --help.");
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const report = await runGatewayCaptureVerification(options);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = exitCodeForReport(report);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
