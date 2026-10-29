import { createServer } from "node:net";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DevSupervisor,
  observationExitCode,
  observeOnce,
  PortBusyError,
  SupervisorBusyError,
  readSupervisorStatus,
} from "../scripts/lib/dev-supervisor-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(
  root,
  "scripts",
  "fixtures",
  "dev-supervisor-synthetic-child.mjs",
);
const evidenceDirectory =
  "/home/ubuntu/circles-people-and-resilience-20261029/evidence/supervisor";
const active = new Set<DevSupervisor>();

async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Synthetic port allocation failed"));
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
  throw new Error("Timed out waiting for synthetic supervisor condition");
}

type SyntheticOptions = {
  mode?:
    | "healthy"
    | "flaky"
    | "crash"
    | "hang"
    | "ready503"
    | "health500"
    | "immediateCrash";
  stateFile?: string;
  secret?: string;
  rssLimitBytes?: number;
};

function syntheticService(port: number, options: SyntheticOptions = {}) {
  const args = [
    "-i",
    "PATH=/usr/bin:/bin",
    `SYNTHETIC_PORT=${port}`,
    `SYNTHETIC_MODE=${options.mode ?? "healthy"}`,
  ];
  if (options.stateFile) args.push(`SYNTHETIC_STATE_FILE=${options.stateFile}`);
  if (options.secret) args.push(`SYNTHETIC_WRITE_SECRET=${options.secret}`);
  args.push(process.execPath, fixture);
  return {
    name: "synthetic",
    port,
    command: "/usr/bin/env",
    args,
    cwd: root,
    cleanEnvironment: true,
    env: {},
    probe: "http" as const,
    readiness: true,
    heapMiB: 64,
    rssLimitBytes: options.rssLimitBytes ?? 64 * 1024 * 1024,
  };
}

function missingExecutableService(port: number) {
  return {
    ...syntheticService(port),
    command: path.join(root, "scripts", "fixtures", "missing-synthetic-child"),
    args: [],
  };
}

async function harness(
  serviceOptions: SyntheticOptions = {},
  supervisorOptions: Record<string, unknown> = {},
  serviceFactory: (port: number) => ReturnType<typeof syntheticService> = (
    port,
  ) => syntheticService(port, serviceOptions),
) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "circles-supervisor-test-"),
  );
  const port = await freePort();
  const supervisor = new DevSupervisor({
    projectDir: root,
    stateDir: path.join(directory, "state"),
    services: [serviceFactory(port)],
    intervalMs: 35,
    probeTimeoutMs: 60,
    startupGraceMs: 90,
    consecutiveFailures: 2,
    rssConsecutiveSamples: 2,
    restartBaseMs: 30,
    restartMaxMs: 60,
    restartWindowMs: 2_000,
    retryCap: 3,
    drainTimeoutMs: 200,
    ...supervisorOptions,
  });
  active.add(supervisor);
  await supervisor.start();
  return { directory, port, supervisor };
}

async function closeHarness(value: {
  directory: string;
  supervisor: DevSupervisor;
}) {
  active.delete(value.supervisor);
  await value.supervisor.stop("test_cleanup");
  await rm(value.directory, { recursive: true, force: true });
}

afterEach(async () => {
  await Promise.all(
    [...active].map((supervisor) => supervisor.stop("test_after_each")),
  );
  active.clear();
});

describe.sequential("development supervisor", () => {
  it("recovers a synthetic owned crash with a new generation and restored health", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "circles-supervisor-flaky-"),
    );
    const marker = path.join(directory, "first-generation.txt");
    const port = await freePort();
    const supervisor = new DevSupervisor({
      projectDir: root,
      stateDir: path.join(directory, "state"),
      services: [syntheticService(port, { mode: "flaky", stateFile: marker })],
      intervalMs: 35,
      probeTimeoutMs: 60,
      startupGraceMs: 90,
      consecutiveFailures: 2,
      restartBaseMs: 30,
      restartMaxMs: 60,
      restartWindowMs: 2_000,
      retryCap: 3,
      drainTimeoutMs: 200,
    });
    active.add(supervisor);
    try {
      await supervisor.start();
      const firstPid = (await supervisor.status()).services[0].child?.pid;
      await waitFor(async () => {
        const status = await supervisor.status();
        return (
          status.services[0].generation >= 2 &&
          status.services[0].liveness === "healthy" &&
          status.services[0].readiness === "ready"
        );
      });
      const recovered = await supervisor.status();
      const replacementPid = recovered.services[0].child?.pid;
      expect(firstPid).toBeTypeOf("number");
      expect(replacementPid).toBeTypeOf("number");
      expect(replacementPid).not.toBe(firstPid);
      expect(recovered.services[0].generation).toBeGreaterThanOrEqual(2);

      await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
      await chmod(evidenceDirectory, 0o700);
      const evidence = {
        kind: "finite-synthetic-crash-recovery",
        generatedAt: new Date().toISOString(),
        ports: {
          synthetic: port,
          api3000Touched: false,
          metro8081Touched: false,
        },
        initialPid: firstPid,
        replacementPid,
        generation: recovered.services[0].generation,
        liveness: recovered.services[0].liveness,
        readiness: recovered.services[0].readiness,
        outcome: "owned synthetic child replaced and local health restored",
      };
      const evidenceFile = path.join(
        evidenceDirectory,
        "synthetic-crash-recovery.json",
      );
      await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, {
        mode: 0o600,
      });
      await chmod(evidenceFile, 0o600);
      expect(JSON.parse(await readFile(evidenceFile, "utf8"))).toMatchObject({
        outcome: "owned synthetic child replaced and local health restored",
      });
    } finally {
      active.delete(supervisor);
      await supervisor.stop("test_cleanup");
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("restarts an owned hung child only after startup grace and consecutive local liveness failures", async () => {
    const value = await harness({ mode: "hang" });
    try {
      await waitFor(
        async () =>
          (await value.supervisor.status()).services[0].generation >= 2,
      );
      const status = await value.supervisor.status();
      expect(status.services[0].generation).toBeGreaterThanOrEqual(2);
      const events = await readFile(
        path.join(value.directory, "state", "events.ndjson"),
        "utf8",
      );
      expect(events).toContain("liveness_failure");
      expect(events).toContain("consecutive_liveness_failure");
    } finally {
      await closeHarness(value);
    }
  });

  it("reports dependency readiness 503 as degraded without restart churn", async () => {
    const value = await harness({ mode: "ready503" });
    try {
      await waitFor(
        async () =>
          (await value.supervisor.status()).services[0].readiness ===
          "degraded",
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      const status = await value.supervisor.status();
      expect(status.services[0].generation).toBe(1);
      expect(status.services[0].liveness).toBe("healthy");
      expect(status.services[0].readiness).toBe("degraded");
    } finally {
      await closeHarness(value);
    }
  });

  it("treats HTTP 500 liveness as failed and returns the one-shot unhealthy exit code", async () => {
    const value = await harness(
      { mode: "health500" },
      { startupGraceMs: 10_000, consecutiveFailures: 100 },
    );
    try {
      await waitFor(async () => {
        const status = await value.supervisor.status();
        return status.services[0].healthStatus === 500;
      });
      const observation = await observeOnce([
        syntheticService(value.port, { mode: "health500" }),
      ]);
      expect(observation.services[0]).toMatchObject({
        liveness: "unhealthy",
        healthStatus: 500,
      });
      expect(observationExitCode(observation)).toBe(2);
    } finally {
      await closeHarness(value);
    }
  });

  it("restarts an owned HTTP 500 child after consecutive liveness failures", async () => {
    const value = await harness({ mode: "health500" });
    try {
      await waitFor(
        async () =>
          (await value.supervisor.status()).services[0].generation >= 2,
      );
      const events = await readFile(
        path.join(value.directory, "state", "events.ndjson"),
        "utf8",
      );
      expect(events).toContain("liveness_failure");
      expect(events).toContain('"status":500');
      expect(events).toContain("consecutive_liveness_failure");
    } finally {
      await closeHarness(value);
    }
  });

  it("captures immediate owned process.exit(1) events and applies the retry cap", async () => {
    const value = await harness(
      { mode: "immediateCrash" },
      { retryCap: 1, restartBaseMs: 20, restartMaxMs: 20 },
    );
    try {
      await waitFor(
        async () =>
          (await value.supervisor.status()).services[0].circuitOpen === true,
      );
      const status = await value.supervisor.status();
      const events = await readFile(
        path.join(value.directory, "state", "events.ndjson"),
        "utf8",
      );
      expect(status.services[0].generation).toBe(2);
      expect(status.services[0].child).toBeNull();
      expect(events).toContain("child_exit");
      expect(events).not.toContain("owned_group_not_proven_empty");
    } finally {
      await closeHarness(value);
    }
  });

  it("contains spawn ENOENT through bounded retry without an unhandled parent failure", async () => {
    const value = await harness(
      {},
      { retryCap: 1, restartBaseMs: 20, restartMaxMs: 20 },
      missingExecutableService,
    );
    try {
      await waitFor(
        async () =>
          (await value.supervisor.status()).services[0].circuitOpen === true,
      );
      const status = await value.supervisor.status();
      const events = await readFile(
        path.join(value.directory, "state", "events.ndjson"),
        "utf8",
      );
      expect(status.services[0].generation).toBe(0);
      expect(status.services[0].child).toBeNull();
      expect(events).toContain("spawn_failed");
      expect(events).toContain("child_error");
      expect(events).toContain("circuit_open");
    } finally {
      await closeHarness(value);
    }
  });

  it("opens the rolling circuit breaker after the retry cap rather than spawning forever", async () => {
    const value = await harness(
      { mode: "crash" },
      { retryCap: 1, restartBaseMs: 20, restartMaxMs: 20 },
    );
    try {
      await waitFor(
        async () =>
          (await value.supervisor.status()).services[0].circuitOpen === true,
      );
      const status = await value.supervisor.status();
      expect(status.services[0].generation).toBe(2);
      expect(status.services[0].child).toBeNull();
    } finally {
      await closeHarness(value);
    }
  });

  it("stops only its owned process group and never resurrects children after an intentional stop", async () => {
    const value = await harness();
    try {
      await waitFor(
        async () =>
          (await value.supervisor.status()).services[0].liveness === "healthy",
      );
      await value.supervisor.stop("test_intentional_stop");
      active.delete(value.supervisor);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const saved = await readSupervisorStatus(
        path.join(value.directory, "state"),
      );
      expect(saved.found).toBe(true);
      expect(saved.state.mode).toBe("stopped");
      expect(saved.state.services[0].child).toBeNull();
      const events = (
        await readFile(
          path.join(value.directory, "state", "events.ndjson"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const stopIndex = events.findIndex(
        (event) => event.event === "supervisor_stopping",
      );
      expect(stopIndex).toBeGreaterThan(-1);
      expect(
        events
          .slice(stopIndex + 1)
          .some((event) => event.event === "child_spawned"),
      ).toBe(false);
    } finally {
      await closeHarness(value);
    }
  });

  it("refuses an occupied synthetic port without stopping the unknown listener", async () => {
    const port = await freePort();
    const listener = createServer((socket) => socket.end("synthetic"));
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(port, "127.0.0.1", () => resolve());
    });
    const directory = await mkdtemp(
      path.join(tmpdir(), "circles-supervisor-busy-"),
    );
    const supervisor = new DevSupervisor({
      projectDir: root,
      stateDir: path.join(directory, "state"),
      services: [syntheticService(port)],
    });
    try {
      await expect(supervisor.start()).rejects.toBeInstanceOf(PortBusyError);
      expect(listener.listening).toBe(true);
    } finally {
      await supervisor.stop("test_cleanup");
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses a live second supervisor lock without adopting either child", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "circles-supervisor-lock-"),
    );
    const firstPort = await freePort();
    const secondPort = await freePort();
    const common = {
      projectDir: root,
      stateDir: path.join(directory, "state"),
      intervalMs: 35,
      probeTimeoutMs: 60,
      startupGraceMs: 90,
      restartBaseMs: 30,
      drainTimeoutMs: 200,
    };
    const first = new DevSupervisor({
      ...common,
      services: [syntheticService(firstPort)],
    });
    const second = new DevSupervisor({
      ...common,
      services: [syntheticService(secondPort)],
    });
    active.add(first);
    try {
      await first.start();
      await expect(second.start()).rejects.toBeInstanceOf(SupervisorBusyError);
      expect((await first.status()).services[0].child?.pid).toBeTypeOf(
        "number",
      );
    } finally {
      active.delete(first);
      await first.stop("test_cleanup");
      await second.stop("test_cleanup");
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps synthetic child output and secrets out of bounded private logs and status", async () => {
    const secret = "SYNTHETIC_SECRET_MUST_NOT_PERSIST";
    const value = await harness(
      { mode: "healthy", secret },
      { logMaxBytes: 280, logFiles: 3 },
    );
    try {
      await waitFor(
        async () =>
          (await value.supervisor.status()).services[0].liveness === "healthy",
      );
      for (let index = 0; index < 2; index += 1)
        await value.supervisor.pollNow();
      const stateDirectory = path.join(value.directory, "state");
      const files = (await readdir(stateDirectory)).filter((file) =>
        file.startsWith("events.ndjson"),
      );
      expect(files.length).toBeLessThanOrEqual(3);
      const logText = await Promise.all(
        files.map((file) => readFile(path.join(stateDirectory, file), "utf8")),
      );
      const statusText = await readFile(
        path.join(stateDirectory, "status.json"),
        "utf8",
      );
      expect(`${logText.join("\n")}${statusText}`).not.toContain(secret);
      for (const file of [...files, "status.json"]) {
        expect((await stat(path.join(stateDirectory, file))).mode & 0o077).toBe(
          0,
        );
      }
    } finally {
      await closeHarness(value);
    }
  });

  it("records null resource fields when unavailable and restarts only an identity-verified owned RSS breach", async () => {
    const unavailable = await harness(
      {},
      {
        resourceSampler: async () => {
          throw new Error("synthetic resource reader unavailable");
        },
      },
    );
    try {
      await waitFor(
        async () => (await unavailable.supervisor.status()).resources === null,
      );
      expect((await unavailable.supervisor.status()).resources).toBeNull();
    } finally {
      await closeHarness(unavailable);
    }

    const threshold = await harness(
      { rssLimitBytes: 1 },
      {
        rssConsecutiveSamples: 1,
        rssSampler: async () => ({ totalBytes: 1024, processCount: 1 }),
      },
    );
    try {
      await waitFor(
        async () =>
          (await threshold.supervisor.status()).services[0].generation >= 2,
      );
      const events = await readFile(
        path.join(threshold.directory, "state", "events.ndjson"),
        "utf8",
      );
      expect(events).toContain("owned_rss_threshold");
    } finally {
      await closeHarness(threshold);
    }
  });
});
