import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const runner = readFileSync(
  new URL("../scripts/run-circle-home-e2e.py", import.meta.url),
  "utf8",
);
const config = readFileSync(
  new URL("../e2e/moderation.e2e.config.ts", import.meta.url),
  "utf8",
);

describe("isolated Moderator Report Workspace E2E CI", () => {
  it("runs the strict moderation suite only after verified PG17/psycopg provisioning", () => {
    const tools = workflow.indexOf(
      "name: Install isolated Circle Home PostgreSQL 17 test tools",
    );
    const moderation = workflow.indexOf(
      "name: Run isolated Moderator Workspace HTTP and PostgreSQL E2E",
    );
    expect(tools).toBeGreaterThan(-1);
    expect(moderation).toBeGreaterThan(tools);
    expect(workflow).toContain("postgresql-17 python3-psycopg");
    expect(workflow).toContain("/usr/lib/postgresql/17/bin/initdb --version");
    expect(workflow).toContain("run: pnpm test:e2e:moderation");
    expect(workflow).toContain("Signed-By:");
    expect(workflow).not.toContain("trusted=yes");
  });

  it("keeps moderation outside default discovery and requires the complete reviewed migration pair", () => {
    expect(config).toContain('include: ["e2e/moderation.e2e.ts"]');
    expect(runner).toContain("choices=SUITES");
    expect(runner).toContain('"moderation"');
    expect(runner).toContain("e2e/moderation.e2e.config.ts");
    expect(runner).toContain("0012_circles_moderation.sql");
    expect(runner).toContain("0013_circles_ops_moderation_health.sql");
    expect(runner).toContain("CIRCLE_HOME_E2E_TOKEN");
    expect(runner).not.toContain("DATABASE_URL");
  });

  it("keeps moderation CI read-only without application credential declarations", () => {
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toMatch(
      /secrets\.(SUPABASE_DATABASE_URL|DATABASE_URL)/,
    );
    expect(workflow).not.toContain("contents: write");
  });
});
