import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("container source validation", () => {
  it("runs for API and dependency changes as well as manual invocation", () => {
    const workflow = readFileSync(
      ".github/workflows/container-validation.yml",
      "utf8",
    );
    expect(workflow).toMatch(/\n  push:\n/);
    expect(workflow).toMatch(/\n  pull_request:\n/);
    expect(workflow).toMatch(/\n  workflow_dispatch:/);
    for (const path of [
      "server/**",
      "shared/**",
      "drizzle/**",
      "patches/**",
      "package.json",
      "pnpm-lock.yaml",
      "Dockerfile",
    ]) {
      expect(workflow).toContain(path);
    }
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("contents: write");
  });
});
