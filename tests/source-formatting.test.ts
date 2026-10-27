import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type Formatter = {
  isSourceFormattingPath: (filename: string) => boolean;
  collectSourceFormattingFiles: (
    root: string,
    candidates: string[],
  ) => string[];
};
const formatter = (await import(
  pathToFileURL(
    path.resolve(import.meta.dirname, "../scripts/format-source.mjs"),
  ).href
)) as Formatter;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function temporaryRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "circles-format-test-"));
  roots.push(root);
  return root;
}

describe("tracked source formatting", () => {
  it("includes application and operator source/configuration", () => {
    for (const filename of [
      "app/(tabs)/index.tsx",
      "server/_core/index.ts",
      "scripts/recover-api.mjs",
      "operations/tests/security-audit.node.mjs",
      ".github/workflows/ci.yml",
      "package.json",
    ])
      expect(formatter.isSourceFormattingPath(filename)).toBe(true);
  });
  it("excludes protected, generated and historical inputs", () => {
    for (const filename of [
      ".env",
      ".env.example",
      "artifacts/bundles/app.js",
      ".expo/types/router.d.ts",
      "dist/index.js",
      "node_modules/example/index.js",
      "scripts/__pycache__/runner.pyc",
      "server/.env.json",
      "drizzle/meta/0000_snapshot.json",
      "pnpm-lock.yaml",
      "skills/example/scripts/recover-api.mjs",
      "design-audit/items/home.md",
      "scripts/design-audit-workflow.js",
    ])
      expect(formatter.isSourceFormattingPath(filename)).toBe(false);
  });
  it("rejects noncanonical and unsafe paths", () => {
    for (const filename of [
      "../server/index.ts",
      "/server/index.ts",
      "server/../private.ts",
      "server//index.ts",
      "server\\index.ts",
      "server/file\n.ts",
      "server/./index.ts",
      "server/file\0.ts",
    ])
      expect(formatter.isSourceFormattingPath(filename)).toBe(false);
  });
  it("formats only supplied tracked regular files, deduplicated in order", () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, "server"));
    for (const filename of ["a.ts", "b.ts", "untracked.ts"])
      writeFileSync(path.join(root, "server", filename), "export {};\n");
    expect(
      formatter.collectSourceFormattingFiles(root, [
        "server/b.ts",
        "server/a.ts",
        "server/a.ts",
        "server/missing.ts",
      ]),
    ).toEqual(["server/a.ts", "server/b.ts"]);
  });
  it("refuses symlinks and parent-directory escapes", () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    mkdirSync(path.join(root, "server"));
    writeFileSync(path.join(outside, "private.ts"), "export {};\n");
    symlinkSync(
      path.join(outside, "private.ts"),
      path.join(root, "server", "linked.ts"),
    );
    symlinkSync(outside, path.join(root, "lib"));
    expect(
      formatter.collectSourceFormattingFiles(root, [
        "server/linked.ts",
        "lib/private.ts",
      ]),
    ).toEqual([]);
  });
});
