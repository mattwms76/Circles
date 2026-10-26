import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const runnerPath = resolve(
  process.cwd(),
  "scripts/run-email-auth-http-e2e.mjs",
);

async function runnerSource() {
  return readFile(runnerPath, "utf8");
}

describe("email-auth HTTP PG17 runner safety contract", () => {
  it("is opt-in, loopback-only, credential-free, and avoids production database inputs", async () => {
    const source = await runnerSource();

    expect(source).toContain(
      'const OPT_IN_ENV = "CIRCLES_EMAIL_AUTH_LOCAL_PG17"',
    );
    expect(source).toContain('process.env[OPT_IN_ENV] !== "1"');
    expect(source).toContain('const LOOPBACK_HOST = "127.0.0.1"');
    expect(source).toContain("const RESERVED_PORTS = new Set([3000, 8081])");
    expect(source).toContain("delete process.env.DATABASE_URL");
    expect(source).toContain("delete process.env.SUPABASE_DATABASE_URL");
    expect(source).toContain('provider_boundary: "in-process-mock"');
    expect(source).toContain("credential_free: true");
    expect(source).toContain("production_access: false");
    expect(source).toContain("production_writes: false");
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(source).not.toContain("SUPABASE_ACCESS_TOKEN");
  });

  it("uses the actual local PG components and marks the actor lookup as a fixture-only adapter", async () => {
    const source = await runnerSource();

    expect(source).toContain("new RuntimeRolePool({");
    expect(source).toContain("new EmailIdentityStore({");
    expect(source).toContain("new DrizzleApplicationSessionStore(");
    expect(source).toContain("new SDKServer(undefined, localSessionStore)");
    expect(source).toContain("registerEmailAuthRoutes(app, {");
    expect(source).toContain("sdkServer.verifySession(token)");
    expect(source).toContain("sdkServer.revokeRequestSessions(req)");
    expect(source).toContain("const databaseSchema = {");
    expect(source).toContain("...coreSchema");
    expect(source).toContain("...sessionSchema");
    expect(source).toContain("...liveSchema");
    expect(source).toContain("...activitySchema");
    expect(source).toContain("...moderationSchema");
    expect(source).toContain("!Number.isSafeInteger(session.userId)");
    expect(source).toContain("fingerprintApplicationSession(firstSessionId)");
    expect(source).toContain("Fixture-only actor lookup adapter");
    expect(source).toContain("clearAcceptedSessionCookies(req, res)");
  });

  it("applies reviewed source migrations through email identity and records bounded completion evidence", async () => {
    const source = await runnerSource();

    expect(source).toContain('"drizzle/postgres/0000_circles_app.sql"');
    for (let migration = 1; migration <= 14; migration += 1) {
      expect(source).toContain(
        `"operations/migrations/${String(migration).padStart(4, "0")}_`,
      );
    }
    expect(source).toContain("relforcerowsecurity AS force_rls");
    expect(source).toContain("has_table_privilege('circles_app_runtime'");
    expect(source).toContain("actual_case_count");
    expect(source).toContain("disposable_fixture_removed");
    expect(source).toContain("RUNNER_TIMEOUT_MS");
    expect(source).toContain('evidence.state = "unfinished"');
  });
});
