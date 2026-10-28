import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTESTED_CAPTURE_NOT_INDEPENDENTLY_AUTHENTICATED,
  DASHBOARD_AUTHENTICATION_ORIGIN,
  DASHBOARD_CAPTURE_SOURCE_VERSION,
  DASHBOARD_SETTINGS_ORIGIN,
  DASHBOARD_SETTINGS_PATH,
  MANAGEMENT_API_TOKEN_ENV,
  MANAGEMENT_API_URL,
  PROJECT_REF,
  PUBLIC_GATEWAY_KEY_ENV,
  PUBLIC_GATEWAY_URL,
  createGatewayProbePlan,
  evaluateDashboardSettingsCapture,
  evaluateManagementApiCapture,
  evaluateSettingsToGatewayProbes,
  executeGatewaySchemaProbes,
  exitCodeForReport,
  fetchManagementApiCapture,
  normalizeDashboardSettingsCapture,
  normalizeManagementApiPostgrestResponse,
  parseArgs,
  runGatewayCaptureVerification,
  settingsFingerprint,
} from "../../scripts/remaining-db13-gateway-capture.mjs";

const NOW = new Date("2026-10-28T16:00:00.000Z");

function dashboardCapture(overrides = {}) {
  const capture = {
    capture_version: 1,
    source: {
      provider: "supabase",
      kind: "authenticated_dashboard_settings",
      source_version: DASHBOARD_CAPTURE_SOURCE_VERSION,
      project_ref: PROJECT_REF,
      observed_at: "2026-10-28T15:50:00.000Z",
      transport: {
        protocol: "https",
        request_method: "GET",
        origin: DASHBOARD_SETTINGS_ORIGIN,
        path: DASHBOARD_SETTINGS_PATH,
        response_status: 200,
        authentication_origin: DASHBOARD_AUTHENTICATION_ORIGIN,
      },
    },
    settings: {
      exposed_schemas: ["public", "graphql_public"],
      auto_expose_new_tables: false,
    },
  };
  return {
    ...capture,
    ...overrides,
    source: {
      ...capture.source,
      ...overrides.source,
      transport: {
        ...capture.source.transport,
        ...overrides.source?.transport,
      },
    },
    settings: {
      ...capture.settings,
      ...overrides.settings,
    },
  };
}

function postgrestResponse(overrides = {}) {
  return {
    db_schema: "public,graphql_public",
    max_rows: 1_000,
    db_extra_search_path: "public,extensions",
    db_pool: 20,
    db_pool_acquisition_timeout: 10,
    ...overrides,
  };
}

function response(body, status = 200, contentLength = null) {
  return {
    status,
    headers: {
      get(name) {
        return name === "content-length" ? contentLength : null;
      },
    },
    text: async () => JSON.stringify(body),
  };
}

test("DB-13 validates a complete local settings attestation but rejects full closure", () => {
  const normalized = normalizeDashboardSettingsCapture(dashboardCapture(), {
    now: NOW,
  });
  assert.ok(normalized);
  assert.equal(normalized.kind, "attested_dashboard_settings_capture");
  assert.equal(normalized.settings.auto_expose_new_tables, false);
  assert.deepEqual(normalized.settings.exposed_schemas, [
    "public",
    "graphql_public",
  ]);

  const report = evaluateDashboardSettingsCapture(normalized);
  assert.equal(report.status, "unknown");
  assert.equal(report.reason, ATTESTED_CAPTURE_NOT_INDEPENDENTLY_AUTHENTICATED);
  assert.equal(report.checks[0].status, "pass");
  assert.equal(report.checks[1].status, "unknown");
  assert.equal(report.checks[2].attested_value_status, "pass");
  assert.equal(report.checks[3].attested_value_status, "pass");
  assert.equal(report.checks[4].status, "not_run");
  assert.equal(exitCodeForReport(report), 2);
});

test("DB-13 keeps locally attested unsafe values separate from an authenticated provider conclusion", () => {
  const privateSchema = normalizeDashboardSettingsCapture(
    dashboardCapture({
      settings: { exposed_schemas: ["public", "circles_app"] },
    }),
    { now: NOW },
  );
  assert.ok(privateSchema);
  const privateReport = evaluateDashboardSettingsCapture(privateSchema);
  assert.equal(privateReport.status, "unknown");
  assert.equal(
    privateReport.reason,
    ATTESTED_CAPTURE_NOT_INDEPENDENTLY_AUTHENTICATED,
  );
  assert.equal(privateReport.checks[2].attested_value_status, "fail");
  assert.deepEqual(privateReport.checks[2].exposed_circles_schemas, [
    "circles_app",
  ]);

  const automatic = normalizeDashboardSettingsCapture(
    dashboardCapture({ settings: { auto_expose_new_tables: true } }),
    { now: NOW },
  );
  assert.ok(automatic);
  const automaticReport = evaluateDashboardSettingsCapture(automatic);
  assert.equal(automaticReport.status, "unknown");
  assert.equal(automaticReport.checks[3].attested_value_status, "fail");
  assert.equal(exitCodeForReport(automaticReport), 2);
});

test("DB-13 rejects invalid local captures and never lets a forged literal close the candidate", () => {
  assert.equal(
    normalizeDashboardSettingsCapture(
      dashboardCapture({
        source: { observed_at: "2026-10-28T15:44:59.999Z" },
      }),
      { now: NOW },
    ),
    null,
  );
  assert.equal(
    normalizeDashboardSettingsCapture(
      dashboardCapture({ source: { project_ref: "abcdefghijklmnopqrst" } }),
      { now: NOW },
    ),
    null,
  );
  assert.equal(
    normalizeDashboardSettingsCapture(
      dashboardCapture({ settings: { auto_expose_new_tables: null } }),
      { now: NOW },
    ),
    null,
  );
  assert.equal(
    normalizeDashboardSettingsCapture(
      dashboardCapture({
        source: {
          kind: "copied_from_clipboard",
          transport: {
            authentication_origin: "self_asserted_reviewed_true",
          },
        },
      }),
      { now: NOW },
    ),
    null,
  );
  assert.equal(
    normalizeDashboardSettingsCapture(
      dashboardCapture({
        source: { transport: { origin: "https://attacker.invalid" } },
      }),
      { now: NOW },
    ),
    null,
  );

  const forgedButWellShapedLiteral = normalizeDashboardSettingsCapture(
    dashboardCapture(),
    { now: NOW },
  );
  assert.ok(forgedButWellShapedLiteral);
  const forgedReport = evaluateDashboardSettingsCapture(
    forgedButWellShapedLiteral,
  );
  assert.equal(forgedReport.status, "unknown");
  assert.equal(
    forgedReport.reason,
    ATTESTED_CAPTURE_NOT_INDEPENDENTLY_AUTHENTICATED,
  );
  assert.notEqual(forgedReport.status, "pass");
  assert.equal(exitCodeForReport(forgedReport), 2);
});

test("DB-13 pins the partial Management API transport and preserves the automatic setting as unknown", async () => {
  let request;
  const capture = await fetchManagementApiCapture({
    token: "synthetic-management-token",
    now: NOW,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response(postgrestResponse());
    },
  });
  assert.ok(capture);
  assert.equal(request.url, MANAGEMENT_API_URL);
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.redirect, "error");
  assert.equal(
    request.options.headers.authorization,
    "Bearer synthetic-management-token",
  );
  assert.equal(capture.settings.auto_expose_new_tables, null);

  const report = evaluateManagementApiCapture(capture);
  assert.equal(report.status, "unknown");
  assert.equal(report.checks[1].status, "pass");
  assert.equal(report.checks[2].status, "unknown");
  assert.equal(exitCodeForReport(report), 2);
  assert.equal(
    normalizeManagementApiPostgrestResponse({ db_schema: "public" }),
    null,
  );
});

test("DB-13 turns a Management API private schema into FAIL while retaining the toggle as unknown", async () => {
  const capture = await fetchManagementApiCapture({
    token: "synthetic-management-token",
    now: NOW,
    fetchImpl: async () =>
      response(postgrestResponse({ db_schema: "public,circles_identity" })),
  });
  assert.ok(capture);
  const report = evaluateManagementApiCapture(capture);
  assert.equal(report.status, "fail");
  assert.equal(report.checks[1].status, "fail");
  assert.equal(report.checks[2].status, "unknown");
  assert.equal(exitCodeForReport(report), 1);
});

test("DB-13 binds zero-row PGRST106 probes to a local attestation without using them as authentication or a toggle inference", async () => {
  const capture = normalizeDashboardSettingsCapture(dashboardCapture(), {
    now: NOW,
  });
  assert.ok(capture);
  const plan = createGatewayProbePlan(capture);
  assert.ok(plan);
  assert.equal(plan.project_ref, PROJECT_REF);

  const requests = [];
  const probes = await executeGatewaySchemaProbes(capture, {
    publicAnonKey: "synthetic-public-anon-key",
    now: NOW,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response({ code: "PGRST106" }, 406);
    },
  });
  assert.ok(probes);
  assert.equal(requests.length, plan.schemas.length);
  assert.equal(
    requests[0].url,
    `${PUBLIC_GATEWAY_URL}/__circles_db13_schema_probe__?limit=0`,
  );
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(requests[0].options.headers.apikey, "synthetic-public-anon-key");
  assert.equal(requests[0].options.headers["accept-profile"], "circles_app");
  assert.ok(probes.checks.every((check) => check.status === "rejected"));

  const report = evaluateSettingsToGatewayProbes(
    capture,
    evaluateDashboardSettingsCapture(capture),
    probes,
  );
  assert.equal(report.status, "unknown");
  assert.equal(report.reason, ATTESTED_CAPTURE_NOT_INDEPENDENTLY_AUTHENTICATED);
  assert.equal(report.checks[4].status, "pass");
  assert.match(report.checks[4].scope, /never establishes.*automatic/i);
  assert.equal(exitCodeForReport(report), 2);

  const managementCapture = await fetchManagementApiCapture({
    token: "synthetic-management-token",
    now: NOW,
    fetchImpl: async () => response(postgrestResponse()),
  });
  assert.ok(managementCapture);
  const managementProbes = await executeGatewaySchemaProbes(managementCapture, {
    publicAnonKey: "synthetic-public-anon-key",
    now: NOW,
    fetchImpl: async () => response({ code: "PGRST106" }, 406),
  });
  const managementReport = evaluateSettingsToGatewayProbes(
    managementCapture,
    evaluateManagementApiCapture(managementCapture),
    managementProbes,
  );
  assert.equal(managementReport.status, "unknown");
  assert.equal(managementReport.checks[2].status, "unknown");
  assert.equal(exitCodeForReport(managementReport), 2);
});

test("DB-13 preserves probe consistency failure without letting a local attestation close the candidate", async () => {
  const capture = normalizeDashboardSettingsCapture(dashboardCapture(), {
    now: NOW,
  });
  assert.ok(capture);
  const probes = await executeGatewaySchemaProbes(capture, {
    publicAnonKey: "synthetic-public-anon-key",
    now: NOW,
    fetchImpl: async () => response({ code: "PGRST205" }, 404),
  });
  assert.ok(probes);

  const failure = evaluateSettingsToGatewayProbes(
    capture,
    evaluateDashboardSettingsCapture(capture),
    probes,
  );
  assert.equal(failure.status, "unknown");
  assert.equal(
    failure.reason,
    ATTESTED_CAPTURE_NOT_INDEPENDENTLY_AUTHENTICATED,
  );
  assert.equal(failure.checks[4].status, "fail");
  assert.ok(failure.checks[4].non_rejected_schemas.length > 0);
  assert.equal(exitCodeForReport(failure), 2);

  const replayed = {
    ...probes,
    settings_fingerprint: "0".repeat(64),
  };
  const untrusted = evaluateSettingsToGatewayProbes(
    capture,
    evaluateDashboardSettingsCapture(capture),
    replayed,
  );
  assert.equal(untrusted.status, "unknown");
  assert.equal(untrusted.checks[4].status, "unknown");
  assert.notEqual(settingsFingerprint(capture), replayed.settings_fingerprint);
});

test("DB-13 file mode and arguments fail closed without inherited credentials", async () => {
  assert.deepEqual(parseArgs(["--capture-file", "/private/db13.json"]), {
    captureFile: "/private/db13.json",
    managementApi: false,
    publicProbe: false,
    help: false,
  });
  assert.deepEqual(parseArgs(["--management-api", "--public-probe"]), {
    captureFile: null,
    managementApi: true,
    publicProbe: true,
    help: false,
  });
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(["--capture-file", "x", "--management-api"]));

  const report = await runGatewayCaptureVerification(
    {
      captureFile: "/private/db13.json",
      managementApi: false,
      publicProbe: false,
      help: false,
    },
    {
      now: NOW,
      env: {},
      readFile: async () => JSON.stringify(dashboardCapture()),
    },
  );
  assert.equal(report.status, "unknown");
  assert.equal(report.reason, ATTESTED_CAPTURE_NOT_INDEPENDENTLY_AUTHENTICATED);
  assert.equal(report.source.kind, "local_dashboard_settings_attestation");
  assert.equal(exitCodeForReport(report), 2);
  assert.equal(
    MANAGEMENT_API_TOKEN_ENV,
    "CIRCLES_SUPABASE_MANAGEMENT_API_TOKEN",
  );
  assert.equal(PUBLIC_GATEWAY_KEY_ENV, "CIRCLES_DB13_PUBLIC_ANON_KEY");
});
