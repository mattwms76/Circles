import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as continuity from "../scripts/recovery-continuity.mjs";

type RunTool = (
  command: string,
  argumentsList: string[],
  timeout: number,
  operation: string,
  options?: { terminationGraceMs?: number },
) => Promise<void>;

const runTool = (continuity as typeof continuity & { runTool: RunTool })
  .runTool;
const temporaryDirectories: string[] = [];

async function privateTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "circles-cba08-"));
  await chmod(directory, 0o700);
  temporaryDirectories.push(directory);
  return directory;
}

async function waitForFile(filename: string) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      return await readFile(filename, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("synthetic_helper_not_ready");
}

async function waitForProcessExit(pid: number) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("synthetic_helper_survived_timeout");
}

afterEach(async () => {
  while (temporaryDirectories.length) {
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("CBA-08 continuity tool termination", () => {
  it.each([
    ["archiver", "continuity_archive_failed"],
    ["encryptor", "continuity_encryption_failed"],
  ])(
    "bounds a TERM-ignoring %s and allows private temporary cleanup",
    async (_helperName, operation) => {
      const directory = await privateTemporaryDirectory();
      const readyFile = path.join(directory, "helper.pid");
      const helper = path.join(directory, "ignore-term.mjs");
      await writeFile(
        helper,
        [
          'import { writeFileSync } from "node:fs";',
          'process.on("SIGTERM", () => undefined);',
          "writeFileSync(process.argv[2], String(process.pid), { mode: 0o600 });",
          "setInterval(() => undefined, 1_000);",
        ].join("\n"),
        { mode: 0o600 },
      );
      await writeFile(
        path.join(directory, "private-continuity-material"),
        "synthetic",
      );

      let cleanupComplete = false;
      const began = Date.now();
      try {
        const pending = runTool(
          process.execPath,
          [helper, readyFile],
          250,
          operation,
          { terminationGraceMs: 100 },
        );
        const pid = Number((await waitForFile(readyFile)).trim());
        expect(pid).toBeGreaterThan(0);

        await expect(pending).rejects.toMatchObject({ code: operation });
        expect(Date.now() - began).toBeLessThan(2_000);
        await waitForProcessExit(pid);
      } finally {
        await rm(directory, { recursive: true, force: true });
        cleanupComplete = true;
      }

      expect(cleanupComplete).toBe(true);
      await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    },
    10_000,
  );
});
