import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("Circle Home isolated E2E safety", () => {
  it("strips credentials and fails closed on stop/partial-start failures", () => {
    const result = spawnSync(
      "/usr/bin/python3",
      ["-B", "operations/tests/circle_home_runner_test.py"],
      {
        cwd: root,
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", NODE_ENV: "test" },
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Ran 4 tests");
    expect(result.stderr).toContain("OK");
  });

  it("requires a runner-created database and ownership marker before runtime access", () => {
    const suite = readFileSync(
      new URL("../e2e/circle-home.e2e.ts", import.meta.url),
      "utf8",
    );
    expect(suite).toContain("CIRCLE_HOME_E2E_DB");
    expect(suite).toContain("CIRCLE_HOME_E2E_TOKEN");
    expect(suite).toContain("e2e_fixture.guard");
    expect(suite.indexOf("await guardPool.query")).toBeLessThan(
      suite.indexOf("runtimePool = createRuntimeRolePool"),
    );
    const config = readFileSync(
      new URL("../e2e/circle-home.e2e.config.ts", import.meta.url),
      "utf8",
    );
    expect(config).toContain('include: ["e2e/circle-home.e2e.ts"]');
  });
});
