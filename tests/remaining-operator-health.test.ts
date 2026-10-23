import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyReadOnlyEndpoints } from "../scripts/recover-api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recovery = readFileSync(
  path.join(root, "scripts/recover-api.mjs"),
  "utf8",
);
const seeder = readFileSync(path.join(root, "scripts/seed-social.ts"), "utf8");
const guide = readFileSync(path.join(root, "docs/api-recovery.md"), "utf8");
const fallbackMigration = readFileSync(
  path.join(
    root,
    "operations/migrations/0003_circles_ops_history_fallback.sql",
  ),
  "utf8",
);

describe("operator-health outstanding finding regressions", () => {
  it("keeps recovery guidance and source aligned with the PostgreSQL-only 19-query inventory", () => {
    expect(guide).toContain("19 source-derived query procedures");
    expect(guide).toContain("`live.relay`");
    expect(guide).toContain("seven bounded private-schema catalog reads");
    expect(recovery).toContain('"live.relay"');
    expect(recovery).toContain("REQUIRED_IDENTITY_SEQUENCES");
    expect(recovery).toContain("REQUIRED_RUNTIME_POLICIES");
  });

  it("requires active live context before context-dependent positive reads and retains incompleteness", () => {
    expect(recovery).toContain("hasActiveLiveContextAttestation");
    expect(recovery).toContain('"missing_active_live_context"');
    expect(recovery).toContain("activeLiveContext");
    expect(guide).toContain("missing_active_live_context");
    expect(guide).toContain("**incomplete**, not failed");
  });

  it("treats missing live context as incomplete and an attested live denial as failed", async () => {
    const inventory = {
      endpoints: [
        {
          name: "auth.me",
          supported: true,
          requiresAuth: true,
          expected: "authenticated-object",
        },
        {
          name: "live.signals",
          supported: true,
          requiresAuth: true,
          expected: "array",
          input: { streamId: 7, generation: 3 },
        },
      ],
      drift: {
        missingConfigured: [],
        unsupported: [],
        classificationMismatch: [],
      },
    };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const route = new URL(
        typeof input === "string" ? input : input.toString(),
      ).pathname.replace("/api/trpc/", "");
      if (route === "auth.me") {
        return new Response(
          JSON.stringify({ result: { data: { json: { id: 1 } } } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ error: { data: { code: "FORBIDDEN" } } }),
        { status: 403 },
      );
    }) as typeof fetch;

    const incomplete = await verifyReadOnlyEndpoints({
      apiBaseUrl: "http://127.0.0.1:3000",
      inventory,
      auth: { bearerToken: "synthetic", ids: {} } as any,
      fetchImpl,
    });
    expect(incomplete.checks).toContainEqual({
      name: "live.signals",
      check: "positive",
      status: "skipped",
      reason: "missing_active_live_context",
    });

    const deniedAfterAttestation = await verifyReadOnlyEndpoints({
      apiBaseUrl: "http://127.0.0.1:3000",
      inventory,
      auth: {
        bearerToken: "synthetic",
        ids: {},
        activeLiveContext: { streamId: 7, generation: 3 },
      } as any,
      fetchImpl,
    });
    expect(deniedAfterAttestation.checks).toContainEqual({
      name: "live.signals",
      check: "positive",
      status: "failed",
      reason: "query_failed_or_shape_invalid",
    });
  });

  it("requires exact identity ownership/privileges and exact runtime policy shape", () => {
    expect(recovery).toContain("identitySequencesAreComplete");
    expect(recovery).toContain("runtimePoliciesAreExact");
    expect(recovery).toContain('owner_column_name === "id"');
    expect(recovery).toContain("can_update_sequence === false");
    expect(recovery).toContain("runtime_data_migrations_read_policy");
    expect(recovery).toContain("with_check_expression === null");
  });

  it("makes the demo seed default to dry-run and gates writes behind all explicit nonproduction acknowledgements", () => {
    expect(seeder).not.toContain('import "dotenv/config"');
    expect(seeder).toContain('"--acknowledge-public-demo-seed"');
    expect(seeder).toContain(
      'environment.CIRCLES_SEED_TARGET !== "non-production"',
    );
    expect(seeder).toContain("db.transaction((tx) => applySeed(tx))");
    expect(seeder).toContain("pg_advisory_xact_lock");
    expect(seeder).toContain("assertFreshTarget");
    expect(seeder).toContain("fileURLToPath(import.meta.url)");
  });

  it("stages only a transactionally locked replacement of the existing private health function", () => {
    expect(fallbackMigration).toMatch(/\nBEGIN;[\s\S]*COMMIT;\s*$/);
    expect(fallbackMigration).toContain("pg_advisory_xact_lock");
    expect(fallbackMigration).toContain(
      "CREATE OR REPLACE FUNCTION circles_ops.run_daily_migration_health()",
    );
    expect(fallbackMigration).toContain("health_history_unavailable");
    expect(fallbackMigration).toContain("WHEN OTHERS THEN");
    expect(fallbackMigration).not.toMatch(/CREATE\s+SCHEMA/i);
    expect(fallbackMigration).not.toMatch(/CREATE\s+TABLE/i);
    expect(fallbackMigration).not.toMatch(/CREATE\s+POLICY/i);
    expect(fallbackMigration).not.toMatch(/cron\./i);
    expect(fallbackMigration).not.toMatch(
      /(?:INSERT|UPDATE|DELETE)\s+FROM?\s+circles_app/i,
    );
  });

  it("documents parent-owned transactional transport and leaves live audit execution unclaimed", () => {
    expect(guide).toContain("transaction-capable batch");
    expect(guide).toContain("disposable local PostgreSQL fixture");
    expect(guide).toContain(
      "never a failed synthetic test or a claim that an audit was called",
    );
  });
});
