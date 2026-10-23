import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("continuity encryption CI prerequisites", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  it("installs and verifies age/tar before running real encryption tests", () => {
    const prepare = workflow.indexOf(
      "name: Install and verify continuity encryption tools",
    );
    const tests = workflow.indexOf("name: Run unit and regression tests");
    expect(prepare).toBeGreaterThan(-1);
    expect(tests).toBeGreaterThan(prepare);
    expect(workflow).toContain(
      "apt-get install --yes --no-install-recommends age tar",
    );
    expect(workflow).toContain("command -v age");
    expect(workflow).toContain("command -v tar");
    expect(workflow).toContain("age --version");
    expect(workflow).toContain("pnpm test:ci");
  });

  it("uses the same verified Node patch for tests and platform exports", () => {
    expect(workflow.match(/node-version: "22\.23\.4"/g)).toHaveLength(2);
  });
});
