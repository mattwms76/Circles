import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateOutputPaths } from "../scripts/circles-oauth-security-audit.mjs";

const execFileAsync = promisify(execFile);

async function createGitProject(directory: string) {
  const project = path.join(directory, "project");
  await fs.mkdir(path.join(project, "server"), {
    recursive: true,
    mode: 0o700,
  });
  await execFileAsync("git", ["init", "--quiet", project]);
  return project;
}

describe("private audit output path boundary", () => {
  it("rejects a symlinked output parent pointing inside the actual Git tree", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "circles-audit-path-"),
    );
    try {
      await fs.chmod(directory, 0o700);
      const project = await createGitProject(directory);
      const linked = path.join(directory, "linked-project");
      await fs.symlink(project, linked, "dir");
      await expect(
        validateOutputPaths({
          projectDir: project,
          jsonOutput: path.join(linked, "never-written.json"),
          markdownOutput: path.join(directory, "report.md"),
        }),
      ).rejects.toThrow();
      await expect(
        fs.lstat(path.join(project, "never-written.json")),
      ).rejects.toThrow();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it("uses the Git root even when project-dir is a source subdirectory", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "circles-audit-path-"),
    );
    try {
      await fs.chmod(directory, 0o700);
      const project = await createGitProject(directory);
      await expect(
        validateOutputPaths({
          projectDir: path.join(project, "server"),
          jsonOutput: path.join(project, "never-written.json"),
          markdownOutput: path.join(directory, "report.md"),
        }),
      ).rejects.toThrow();
      const paths = await validateOutputPaths({
        projectDir: project,
        jsonOutput: path.join(directory, "report.json"),
        markdownOutput: path.join(directory, "report.md"),
      });
      expect(paths.jsonOutput).toBe(
        path.join(await fs.realpath(directory), "report.json"),
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
