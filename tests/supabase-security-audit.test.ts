import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateExternalPrivileges,
  validateOutputPaths,
  writePrivateNewFile,
} from "../scripts/circles-supabase-security-audit.mjs";

const project = path.resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function privateDirectory() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "circles-supabase-audit-"),
  );
  temporaryDirectories.push(directory);
  await fs.chmod(directory, 0o700);
  return directory;
}

describe("Circles application-schema auditor output boundary", () => {
  it("accepts only new private outputs outside the project Git tree and creates 0600 files exclusively", async () => {
    const directory = await privateDirectory();
    const paths = await validateOutputPaths({
      projectDir: project,
      jsonOutput: path.join(directory, "report.json"),
      markdownOutput: path.join(directory, "report.md"),
    });

    await writePrivateNewFile(paths.jsonOutput, '{"safe":true}\n');
    const metadata = await fs.lstat(paths.jsonOutput);
    expect(metadata.isFile()).toBe(true);
    expect(metadata.mode & 0o077).toBe(0);
    await expect(
      writePrivateNewFile(paths.jsonOutput, "replacement"),
    ).rejects.toThrow();
  });

  it("rejects a project subdirectory and every symlinked output parent without writing a report", async () => {
    const directory = await privateDirectory();
    const privateChild = path.join(directory, "private");
    await fs.mkdir(privateChild, { mode: 0o700 });
    const linked = path.join(directory, "linked");
    await fs.symlink(privateChild, linked, "dir");

    await expect(
      validateOutputPaths({
        projectDir: project,
        jsonOutput: path.join(project, "artifacts", "forbidden-audit.json"),
        markdownOutput: path.join(privateChild, "report.md"),
      }),
    ).rejects.toThrow();
    await expect(
      validateOutputPaths({
        projectDir: project,
        jsonOutput: path.join(linked, "forbidden-audit.json"),
        markdownOutput: path.join(privateChild, "report.md"),
      }),
    ).rejects.toThrow();
    await expect(
      fs.lstat(path.join(privateChild, "forbidden-audit.json")),
    ).rejects.toThrow();
  });
});

describe("Circles application-schema auditor evidence closure", () => {
  it("fails when membership evidence is absent even if all object privilege arrays are empty", () => {
    const result = evaluateExternalPrivileges({
      roles: [{ role_name: "postgres" }],
      schema: { schema_name: "circles_app", owner: "postgres" },
      tables: [],
      columns: [],
      sequences: [],
      routines: [],
      schema_privileges: [],
      table_privileges: [],
      column_privileges: [],
      sequence_privileges: [],
      routine_privileges: [],
      schema_acl_privileges: [],
      table_acl_privileges: [],
      column_acl_privileges: [],
      sequence_acl_privileges: [],
      routine_acl_privileges: [],
    });

    expect(result.status).toBe("fail");
    expect(result.reason).toBe("privilege_evidence_incomplete");
    expect(result.incomplete_evidence).toContain("missing_membership_evidence");
  });
});
