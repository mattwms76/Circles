import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("generated export lint scope", () => {
  it("ignores artifact bundles without ignoring server or test source", async () => {
    const cwd = path.resolve(import.meta.dirname, "..");
    const lint = new ESLint({ cwd });
    expect(
      await lint.isPathIgnored(
        path.join(cwd, "artifacts/bundles/all/_expo/static/js/web/entry.js"),
      ),
    ).toBe(true);
    expect(
      await lint.isPathIgnored(path.join(cwd, "server/_core/index.ts")),
    ).toBe(false);
    expect(
      await lint.isPathIgnored(
        path.join(cwd, "tests/oauth-security-audit.test.ts"),
      ),
    ).toBe(false);
  });
});
