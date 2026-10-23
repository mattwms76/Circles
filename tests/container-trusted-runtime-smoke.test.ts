import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("container trusted-runtime smoke contract", () => {
  it("asserts missing-runtime rejection then uses only synthetic required inputs", () => {
    const workflow = readFileSync(
      ".github/workflows/container-validation.yml",
      "utf8",
    );
    const missing = workflow.indexOf(
      "if docker run --rm circles-api-validation:local",
    );
    const configured = workflow.indexOf(
      "docker run --detach --name circles-api-validation",
    );
    expect(missing).toBeGreaterThan(-1);
    expect(missing).toBeLessThan(configured);
    for (const key of [
      "MANUS_JWT_SECRET",
      "MANUS_PROJECT_ID",
      "MANUS_OAUTH_API_URL",
      "MANUS_OAUTH_PORTAL_URL",
      "SUPABASE_DATABASE_URL",
    ]) {
      expect(workflow).toContain(`--env ${key}`);
    }
    expect(workflow).toContain("SUPABASE_DATABASE_URL=synthetic-invalid-dsn");
    expect(workflow).toContain('test "$status" = 503');
    expect(workflow).not.toMatch(/secrets\./);
    expect(workflow).not.toContain("--env DATABASE_URL");
  });
});
