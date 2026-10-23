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
  new URL("../e2e/activity.e2e.config.ts", import.meta.url),
  "utf8",
);

describe("isolated Activity Inbox E2E CI", () => {
  it("runs the strict Activity suite after verified PG17/psycopg provisioning", () => {
    const tools = workflow.indexOf(
      "name: Install isolated Circle Home PostgreSQL 17 test tools",
    );
    const activity = workflow.indexOf(
      "name: Run isolated Activity Inbox HTTP and PostgreSQL E2E",
    );
    expect(tools).toBeGreaterThan(-1);
    expect(activity).toBeGreaterThan(tools);
    expect(workflow).toContain("postgresql-17 python3-psycopg");
    expect(workflow).toContain("/usr/lib/postgresql/17/bin/initdb --version");
    expect(workflow).toContain("run: pnpm test:e2e:activity");
    expect(workflow).toContain("Signed-By:");
    expect(workflow).not.toContain("trusted=yes");
  });

  it("keeps Activity outside default discovery and permits only its named hardened runner mode", () => {
    expect(config).toContain('include: ["e2e/activity.e2e.ts"]');
    expect(runner).toContain("choices=SUITES");
    expect(runner).toContain('"activity"');
    expect(runner).toContain("e2e/activity.e2e.config.ts");
    expect(runner).toContain("0010_circles_activity_inbox.sql");
    expect(runner).toContain("0011_circles_ops_activity_health.sql");
    expect(runner).toContain("CIRCLE_HOME_E2E_TOKEN");
    expect(runner).not.toContain("DATABASE_URL");
  });

  it("keeps CI read-only without application credential declarations", () => {
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toMatch(
      /secrets\.(SUPABASE_DATABASE_URL|DATABASE_URL)/,
    );
    expect(workflow).not.toContain("contents: write");
  });
});
