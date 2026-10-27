import test from "node:test";
import assert from "node:assert/strict";
import {
  MANAGEMENT_API_TOKEN_ENV,
  MANAGEMENT_API_URL,
  evaluateGatewayExposure,
  evaluateManagementApiEvidence,
  fetchManagementApiPostgrestEvidence,
  normalizeAuthoritativeEvidence,
  normalizePostgrestResponse,
  parseArgs,
  runGatewayExposureVerification,
} from "../../scripts/verify-database-gateway-exposure.mjs";

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

function authoritativeEvidence(overrides = {}) {
  const evidence = {
    evidence_version: 1,
    provenance: {
      provider: "supabase",
      source: "supabase_management_api_and_dashboard",
      project_ref: "vvclcsqletcxzoaayqzq",
      observed_at: "2026-10-27T11:51:00.000Z",
      reviewed: true,
    },
    postgrest: postgrestResponse(),
    auto_expose_new_tables: false,
  };
  return {
    ...evidence,
    ...overrides,
    provenance: { ...evidence.provenance, ...overrides.provenance },
    postgrest: { ...evidence.postgrest, ...overrides.postgrest },
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

test("DB-13 accepts a complete reviewed evidence envelope and passes only the reviewed private configuration", () => {
  const evidence = normalizeAuthoritativeEvidence(authoritativeEvidence());
  assert.ok(evidence);

  const report = evaluateGatewayExposure(evidence);
  assert.equal(report.status, "pass");
  assert.deepEqual(report.checks[1].exposed_circles_schemas, []);
  assert.equal(report.checks[2].enabled, false);
});

test("DB-13 fails closed when an exposed schema has the circles_ prefix", () => {
  const evidence = normalizeAuthoritativeEvidence(
    authoritativeEvidence({
      postgrest: { db_schema: "public,circles_app" },
    }),
  );
  assert.ok(evidence);

  const report = evaluateGatewayExposure(evidence);
  assert.equal(report.status, "fail");
  assert.equal(report.checks[1].status, "fail");
  assert.deepEqual(report.checks[1].exposed_circles_schemas, ["circles_app"]);
});

test("DB-13 treats enabled automatic new-table exposure as a reviewed configuration failure", () => {
  const evidence = normalizeAuthoritativeEvidence(
    authoritativeEvidence({ auto_expose_new_tables: true }),
  );
  assert.ok(evidence);

  const report = evaluateGatewayExposure(evidence);
  assert.equal(report.status, "fail");
  assert.equal(report.checks[2].status, "fail");
});

test("DB-13 rejects malformed, unreviewed, wrong-project, and incomplete authoritative evidence", () => {
  assert.equal(
    normalizeAuthoritativeEvidence(
      authoritativeEvidence({
        provenance: { project_ref: "abcdefghijklmnopqrst" },
      }),
    ),
    null,
  );
  assert.equal(
    normalizeAuthoritativeEvidence(
      authoritativeEvidence({
        provenance: { reviewed: false },
      }),
    ),
    null,
  );
  assert.equal(
    normalizeAuthoritativeEvidence(
      authoritativeEvidence({ auto_expose_new_tables: null }),
    ),
    null,
  );
  assert.equal(normalizePostgrestResponse({ db_schema: "public" }), null);
  assert.equal(
    normalizePostgrestResponse(postgrestResponse({ db_schema: "public,,x" })),
    null,
  );
});

test("DB-13 pins one documented Management API request and keeps its absent automatic-exposure field UNKNOWN", async () => {
  let request;
  const evidence = await fetchManagementApiPostgrestEvidence({
    token: "synthetic-management-token",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response(postgrestResponse());
    },
  });

  assert.ok(evidence);
  assert.equal(request.url, MANAGEMENT_API_URL);
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.headers.accept, "application/json");
  assert.equal(
    request.options.headers.authorization,
    "Bearer synthetic-management-token",
  );

  const report = evaluateManagementApiEvidence(evidence);
  assert.equal(report.status, "unknown");
  assert.equal(report.checks[1].status, "pass");
  assert.equal(report.checks[2].status, "unknown");
});

test("DB-13 reports a Management API circles_* exposure as FAIL without treating the missing automatic setting as PASS", async () => {
  const evidence = await fetchManagementApiPostgrestEvidence({
    token: "synthetic-management-token",
    fetchImpl: async () =>
      response(postgrestResponse({ db_schema: "public,circles_admin" })),
  });
  assert.ok(evidence);

  const report = evaluateManagementApiEvidence(evidence);
  assert.equal(report.status, "fail");
  assert.equal(report.checks[1].status, "fail");
  assert.equal(report.checks[2].status, "unknown");
  assert.match(report.findings[0], /requires review/i);
});

test("DB-13 maps unavailable or malformed provider responses to UNKNOWN without raw response output", async () => {
  const unavailable = await fetchManagementApiPostgrestEvidence({
    token: "synthetic-management-token",
    fetchImpl: async () => response({ not: "a PostgREST response" }),
  });
  assert.equal(unavailable, null);
  assert.equal(evaluateManagementApiEvidence(unavailable).status, "unknown");

  const fromMissingFile = await runGatewayExposureVerification(
    { settingsFile: "/missing/DB-13-settings.json", managementApi: false },
    { readFile: async () => Promise.reject(new Error("synthetic")) },
  );
  assert.equal(fromMissingFile.status, "unknown");
  assert.equal(fromMissingFile.source.kind, "authoritative_settings_file");
});

test("DB-13 argument parsing requires exactly one approved evidence source", () => {
  assert.deepEqual(parseArgs(["--settings-file", "/private/DB-13.json"]), {
    settingsFile: "/private/DB-13.json",
    managementApi: false,
    help: false,
  });
  assert.deepEqual(parseArgs(["--management-api"]), {
    settingsFile: null,
    managementApi: true,
    help: false,
  });
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(["--settings-file", "x", "--management-api"]));
  assert.equal(
    MANAGEMENT_API_TOKEN_ENV,
    "CIRCLES_SUPABASE_MANAGEMENT_API_TOKEN",
  );
});
