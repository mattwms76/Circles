import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DevSupervisor,
  processIdentity,
  readSupervisorStatus,
} from "../scripts/lib/dev-supervisor-core.mjs";

async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Synthetic CBA-07 port allocation failed"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    "Timed out waiting for synthetic CBA-07 supervisor condition",
  );
}

async function processAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    return code === "EPERM";
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const rootExitsFirstSource = String.raw`
  import { spawn } from "node:child_process";
  import { writeFile } from "node:fs/promises";
  import { createServer } from "node:http";

  const descendantSource = [
    'import { writeFile } from "node:fs/promises";',
    'process.on("SIGTERM", () => undefined);',
    'await writeFile(process.env.SYNTHETIC_DESCENDANT_READY, String(process.pid), { mode: 0o600 });',
    'setInterval(() => {}, 1_000);',
  ].join("\n");
  const descendant = spawn(
    process.execPath,
    ["--input-type=module", "--eval", descendantSource],
    { stdio: "ignore" },
  );
  const server = createServer((request, response) => {
    if (request.url === "/api/health" || request.url === "/api/ready") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(Number(process.env.SYNTHETIC_PORT), "127.0.0.1");
  process.once("SIGTERM", () => process.exit(0));
  setInterval(() => {}, 1_000);
`;

describe.sequential("CBA-07 verified supervisor group drain", () => {
  let supervisor: DevSupervisor | null = null;
  let rootPid: number | null = null;
  let descendantPid: number | null = null;

  afterEach(async () => {
    await supervisor?.stop("cba07_after_each");
    if (
      rootPid !== null &&
      descendantPid !== null &&
      (await processAlive(descendantPid))
    ) {
      // This fallback targets only the test's own still-observed detached group. It runs only when
      // the assertion or supervisor cleanup failed before the CBA-07 repair could reap it.
      const descendant = await processIdentity(descendantPid);
      if (descendant?.pgrp === rootPid) {
        try {
          process.kill(-rootPid, "SIGKILL");
        } catch {
          // The self-created group may already be gone.
        }
      }
    }
    supervisor = null;
    rootPid = null;
    descendantPid = null;
  });

  it("CBA-07 kills a TERM-ignoring descendant before recording a clean stopped state", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "circles-cba07-"));
    const stateDir = path.join(directory, "state");
    const descendantReady = path.join(directory, "descendant-ready");
    const port = await freePort();
    supervisor = new DevSupervisor({
      projectDir: directory,
      stateDir,
      services: [
        {
          name: "cba07synthetic",
          port,
          command: process.execPath,
          args: ["--input-type=module", "--eval", rootExitsFirstSource],
          cwd: directory,
          cleanEnvironment: true,
          env: {
            SYNTHETIC_DESCENDANT_READY: descendantReady,
            SYNTHETIC_PORT: String(port),
          },
          probe: "http",
          readiness: true,
          heapMiB: 64,
          rssLimitBytes: 64 * 1024 * 1024,
        },
      ],
      intervalMs: 50,
      probeTimeoutMs: 80,
      startupGraceMs: 2_000,
      drainTimeoutMs: 150,
    });

    try {
      await supervisor.start();
      rootPid = (await supervisor.status()).services[0].child?.pid ?? null;
      expect(rootPid).toBeTypeOf("number");
      await waitFor(() => fileExists(descendantReady));
      descendantPid = Number(await readFile(descendantReady, "utf8"));
      expect(Number.isInteger(descendantPid)).toBe(true);
      if (descendantPid === null) {
        throw new Error("Synthetic CBA-07 descendant PID was unavailable");
      }
      const verifiedDescendantPid = descendantPid;

      const descendant = await processIdentity(verifiedDescendantPid);
      expect(descendant?.pgrp).toBe(rootPid);
      expect(await processAlive(verifiedDescendantPid)).toBe(true);

      await expect(supervisor.stop("cba07_root_exits_first")).resolves.toBe(
        true,
      );
      await waitFor(async () => !(await processAlive(verifiedDescendantPid)));

      const saved = await readSupervisorStatus(stateDir);
      expect(saved.found).toBe(true);
      expect(saved.state).toMatchObject({
        mode: "stopped",
        services: [{ child: null }],
      });
      expect(
        await fileExists(path.join(stateDir, "supervisor.lock.json")),
      ).toBe(false);

      const events = (
        await readFile(path.join(stateDir, "events.ndjson"), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const forceKillIndex = events.findIndex(
        (event) => event.event === "owned_group_force_killed",
      );
      const drainedIndex = events.findIndex(
        (event) => event.event === "owned_group_drained",
      );
      const stoppedIndex = events.findIndex(
        (event) => event.event === "supervisor_stopped",
      );
      expect(forceKillIndex).toBeGreaterThan(-1);
      expect(drainedIndex).toBeGreaterThan(forceKillIndex);
      expect(stoppedIndex).toBeGreaterThan(drainedIndex);
    } finally {
      await supervisor?.stop("cba07_test_cleanup");
      await rm(directory, { recursive: true, force: true });
    }
  });
});
