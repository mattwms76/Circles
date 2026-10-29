import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/container-validation.yml";

describe("container readiness CI contract", () => {
  it("replaces the stale singleton body check with an exact redacted fail-closed contract", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).not.toContain('assert r == {"ok": False}');
    expect(workflow).toContain('test "$status" = 503');
    expect(workflow).toContain("expected_keys = {");
    for (const key of [
      "ok",
      "liveRelay",
      "liveReady",
      "mediaUploadBudget",
      "mediaUploadReady",
    ]) {
      expect(workflow).toContain(`"${key}",`);
    }
    expect(workflow).toContain("assert set(response) == expected_keys");
    expect(workflow).toContain(
      "assert all(type(response[key]) is bool for key in expected_keys)",
    );
    expect(workflow).toContain('assert response["ok"] is False');
    expect(workflow).toContain('assert response["liveReady"] is False');
    expect(workflow).toContain('assert response["mediaUploadReady"] is False');
  });

  it("uses an env-isolated bounded public probe on an ephemeral loopback port", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain('env -i PATH="$PATH" HOME="$HOME" docker "$@"');
    expect(workflow).not.toContain('HOME="$HOME" command docker');
    expect(workflow).toContain("--publish 127.0.0.1::3000");
    expect(workflow).toContain('"$host_port" == 3000');
    expect(workflow).toContain('"$host_port" == 8081');
    expect(workflow).toContain("curl --connect-timeout 2 --max-time 5");
    expect(workflow).toContain(
      "trap 'docker rm --force circles-api-validation",
    );
  });

  it("executes the workflow Docker wrapper and strips unrelated environment values", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const matched = workflow.match(/^ {10}docker\(\) \{[\s\S]*?^ {10}\}/m);
    expect(matched).not.toBeNull();
    const wrapper = matched![0]
      .split("\n")
      .map((line) => line.slice(10))
      .join("\n");
    const directory = mkdtempSync(join(tmpdir(), "circles-docker-wrapper-"));
    try {
      const executable = join(directory, "docker");
      writeFileSync(
        executable,
        '#!/bin/sh\nset -eu\ntest "${UNRELATED_PRIVATE_SENTINEL-unset}" = unset\ntest "$1" = inspect\nprintf "synthetic-docker-called\\n"\n',
        { mode: 0o700 },
      );
      chmodSync(executable, 0o700);
      const result = spawnSync(
        "/bin/bash",
        [
          "--noprofile",
          "--norc",
          "-c",
          `${wrapper}\ndocker inspect synthetic-container`,
        ],
        {
          env: {
            HOME: directory,
            PATH: `${directory}:/usr/bin:/bin`,
            NODE_ENV: "test",
            UNRELATED_PRIVATE_SENTINEL: "synthetic-test-only",
          },
          encoding: "utf8",
          timeout: 3_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("synthetic-docker-called\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
      expect(existsSync(directory)).toBe(false);
    }
  });
});
