import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const workflow = readFileSync(
  path.join(workspaceRoot, ".github/workflows/ci.yml"),
  "utf8",
);
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function temporaryRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "circles-cba12-format-"));
  temporaryRoots.push(root);
  return root;
}

describe("CBA-12 CI tracked formatting gate", () => {
  it("runs the declared tracked-file formatter after install and before other checks", () => {
    const install = workflow.indexOf("name: Install locked dependencies");
    const format = workflow.indexOf("name: Check tracked source formatting");
    const environment = workflow.indexOf(
      "name: Check environment template and safe CI configuration",
    );
    const unitTests = workflow.indexOf("name: Run unit and regression tests");

    expect(install).toBeGreaterThan(-1);
    expect(format).toBeGreaterThan(install);
    expect(environment).toBeGreaterThan(format);
    expect(unitTests).toBeGreaterThan(format);
    expect(workflow.match(/pnpm format:check/g)).toHaveLength(1);
    expect(workflow).not.toContain("prettier --check .");
  });

  it("fails a formatting-only defect in a synthetic tracked checkout without rewriting it", () => {
    const root = temporaryRoot();
    const bin = path.join(root, "bin");
    const source = path.join(root, "server", "formatting.ts");
    const malformed = 'export const title={name:"Circles",};\n';

    mkdirSync(path.join(root, "scripts"), { recursive: true });
    mkdirSync(path.join(root, "server"), { recursive: true });
    mkdirSync(path.join(root, "node_modules"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    copyFileSync(
      path.join(workspaceRoot, "scripts", "format-source.mjs"),
      path.join(root, "scripts", "format-source.mjs"),
    );
    symlinkSync(
      path.join(workspaceRoot, "node_modules", "prettier"),
      path.join(root, "node_modules", "prettier"),
      "dir",
    );
    writeFileSync(source, malformed);
    const git = path.join(bin, "git");
    writeFileSync(git, "#!/bin/sh\nprintf 'server/formatting.ts\\0'\n");
    chmodSync(git, 0o755);

    const result = spawnSync(
      process.execPath,
      ["scripts/format-source.mjs", "--check"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          CI: "true",
          PATH: `${bin}:/usr/bin:/bin`,
        },
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "server/formatting.ts",
    );
    expect(readFileSync(source, "utf8")).toBe(malformed);
  });
});
