import { randomUUID } from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createConnection, createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  statfs,
  unlink,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const DEFAULT_PROJECT_DIR = SCRIPT_ROOT;
export const DEFAULT_STATE_DIR = path.join(
  SCRIPT_ROOT,
  "artifacts",
  "private",
  "service-supervision",
);

const LOCK_NAME = "supervisor.lock.json";
const STATUS_NAME = "status.json";
const EVENT_LOG_NAME = "events.ndjson";
const MAX_STATE_BYTES = 64 * 1024;
const DEFAULT_LOG_MAX_BYTES = 256 * 1024;
const DEFAULT_LOG_FILES = 5;
const HISTORY_LIMIT = 40;
const MiB = 1024 * 1024;

export class SupervisorBusyError extends Error {
  constructor(
    message = "A live Circles supervisor already owns this state directory",
  ) {
    super(message);
    this.name = "SupervisorBusyError";
  }
}

export class PortBusyError extends Error {
  constructor(port) {
    super(
      `Port ${port} is already in use; refusing to adopt or stop its owner`,
    );
    this.name = "PortBusyError";
    this.port = port;
  }
}

function nowIso(clock) {
  return new Date(clock.now()).toISOString();
}

function boundedNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fixedString(value, maximum = 96) {
  if (typeof value !== "string") return null;
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?").slice(0, maximum);
}

function safeExitCode(value) {
  return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
}

function safeSignal(value) {
  return typeof value === "string" && /^SIG[A-Z0-9]+$/.test(value)
    ? value
    : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissing(error) {
  return Boolean(error && typeof error === "object" && error.code === "ENOENT");
}

async function removeIfPresent(file) {
  try {
    await unlink(file);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error("Supervisor state directory is not a private directory");
  }
  await chmod(directory, 0o700);
}

async function writePrivateAtomic(file, body) {
  const directory = path.dirname(file);
  await ensurePrivateDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(body, "utf8");
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  await chmod(file, 0o600);
}

async function readPrivateJson(file) {
  try {
    const entry = await lstat(file);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      entry.size > MAX_STATE_BYTES ||
      (entry.mode & 0o077) !== 0
    ) {
      return null;
    }
    const text = await readFile(file, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return null;
    return null;
  }
}

export async function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    const raw = await readFile(`/proc/${pid}/stat`, "utf8");
    const close = raw.lastIndexOf(")");
    if (close === -1) return null;
    const fields = raw
      .slice(close + 2)
      .trim()
      .split(/\s+/);
    // Fields begin with state (field 3): process group is field 5, start time is field 22.
    const pgrp = Number(fields[2]);
    const startTicks = fields[19];
    if (!Number.isInteger(pgrp) || !/^\d+$/.test(startTicks)) return null;
    return { pid, pgrp, startTicks };
  } catch {
    return null;
  }
}

function sameIdentity(expected, actual) {
  return Boolean(
    expected &&
    actual &&
    expected.pid === actual.pid &&
    expected.startTicks === actual.startTicks,
  );
}

async function listenerAvailable(port, host) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };
    server.once("error", (error) => {
      finish(() => {
        if (error && error.code === "EADDRINUSE") {
          resolve(false);
          return;
        }
        reject(error);
      });
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) =>
        finish(() => (error ? reject(error) : resolve(true))),
      );
    });
  });
}

export async function assertPortsAvailable(services) {
  const seen = new Set();
  for (const service of services) {
    if (
      !Number.isInteger(service.port) ||
      service.port < 1 ||
      service.port > 65535
    ) {
      throw new Error("Supervisor service port is invalid");
    }
    if (seen.has(service.port))
      throw new Error("Supervisor service ports must be unique");
    seen.add(service.port);
    for (const host of ["127.0.0.1", "::1"]) {
      try {
        if (!(await listenerAvailable(service.port, host))) {
          throw new PortBusyError(service.port);
        }
      } catch (error) {
        // A system with no IPv6 loopback cannot bind the IPv6 check; the IPv4 check above still
        // protects the fixed local development port. Any other bind error remains a safe refusal.
        if (host === "::1" && error?.code === "EADDRNOTAVAIL") continue;
        throw error;
      }
    }
  }
}

function parseMemInfo(text) {
  const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(text);
  if (!match) return null;
  const bytes = Number(match[1]) * 1024;
  return Number.isSafeInteger(bytes) ? bytes : null;
}

async function readNumberFile(file) {
  try {
    const value = (await readFile(file, "utf8")).trim();
    if (!/^\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  } catch {
    return null;
  }
}

async function cgroupAvailableMemory() {
  const v2Current = await readNumberFile("/sys/fs/cgroup/memory.current");
  let v2Limit = null;
  try {
    const raw = (await readFile("/sys/fs/cgroup/memory.max", "utf8")).trim();
    v2Limit = /^\d+$/.test(raw) ? Number(raw) : null;
  } catch {
    // cgroup v2 is optional.
  }
  if (
    Number.isSafeInteger(v2Current) &&
    Number.isSafeInteger(v2Limit) &&
    v2Limit > 0 &&
    v2Limit < Number.MAX_SAFE_INTEGER
  ) {
    return Math.max(0, v2Limit - v2Current);
  }

  const v1Current = await readNumberFile(
    "/sys/fs/cgroup/memory/memory.usage_in_bytes",
  );
  const v1Limit = await readNumberFile(
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",
  );
  if (
    Number.isSafeInteger(v1Current) &&
    Number.isSafeInteger(v1Limit) &&
    v1Limit > 0 &&
    v1Limit < 2 ** 60
  ) {
    return Math.max(0, v1Limit - v1Current);
  }
  return null;
}

async function readCpuSample() {
  try {
    const first = (await readFile("/proc/stat", "utf8"))
      .split("\n")
      .find((line) => line.startsWith("cpu "));
    if (!first) return null;
    const values = first.trim().split(/\s+/).slice(1).map(Number);
    if (values.length < 4 || values.some((value) => !Number.isFinite(value))) {
      return null;
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    const idle = (values[3] ?? 0) + (values[4] ?? 0);
    return total > 0 ? { total, idle } : null;
  } catch {
    return null;
  }
}

function finiteStatfsValue(value) {
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  return Number.isSafeInteger(value) ? value : null;
}

export async function sampleSystemResources(
  projectDir,
  previousCpu = null,
  clock = Date,
) {
  const [cpuCounter, memoryText, cgroupAvailable, disk] = await Promise.all([
    readCpuSample(),
    readFile("/proc/meminfo", "utf8").catch(() => null),
    cgroupAvailableMemory(),
    statfs(projectDir).catch(() => null),
  ]);
  let cpuPercent = null;
  if (cpuCounter && previousCpu) {
    const total = cpuCounter.total - previousCpu.total;
    const idle = cpuCounter.idle - previousCpu.idle;
    if (total > 0 && idle >= 0 && idle <= total) {
      cpuPercent = Math.max(0, Math.min(100, ((total - idle) / total) * 100));
    }
  }

  let load = null;
  try {
    const values = os.loadavg();
    if (
      Array.isArray(values) &&
      values.length === 3 &&
      values.every(Number.isFinite)
    ) {
      load = { one: values[0], five: values[1], fifteen: values[2] };
    }
  } catch {
    // Unsupported platforms report null rather than an invented zero.
  }

  let diskAvailableBytes = null;
  if (disk) {
    const blockSize = finiteStatfsValue(disk.bsize);
    const availableBlocks = finiteStatfsValue(disk.bavail);
    if (blockSize !== null && availableBlocks !== null) {
      const calculated = blockSize * availableBlocks;
      diskAvailableBytes = Number.isSafeInteger(calculated) ? calculated : null;
    }
  }

  return {
    sampledAt: nowIso(clock),
    cpu: {
      percent: boundedNumber(cpuPercent),
      load,
      cores: Number.isInteger(os.cpus()?.length) ? os.cpus().length : null,
      counter: cpuCounter,
    },
    memory: {
      availableBytes: memoryText ? parseMemInfo(memoryText) : null,
      cgroupAvailableBytes: cgroupAvailable,
    },
    disk: { availableBytes: diskAvailableBytes },
  };
}

function parseRssKb(status) {
  const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
  if (!match) return null;
  const bytes = Number(match[1]) * 1024;
  return Number.isSafeInteger(bytes) ? bytes : null;
}

export async function ownedProcessGroupRss(rootIdentity) {
  if (!rootIdentity || rootIdentity.pgrp !== rootIdentity.pid) return null;
  const current = await processIdentity(rootIdentity.pid);
  if (
    !sameIdentity(rootIdentity, current) ||
    current.pgrp !== rootIdentity.pid
  ) {
    return null;
  }

  let entries;
  try {
    entries = await readdir("/proc", { withFileTypes: true });
  } catch {
    return null;
  }

  let totalBytes = 0;
  let processCount = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    const identity = await processIdentity(pid);
    if (!identity || identity.pgrp !== rootIdentity.pid) continue;
    try {
      const rss = parseRssKb(await readFile(`/proc/${pid}/status`, "utf8"));
      if (rss !== null) {
        totalBytes += rss;
        processCount += 1;
      }
    } catch {
      // Processes can exit during a bounded procfs scan.
    }
  }
  return { totalBytes, processCount };
}

async function processGroupHasMembers(pgrp) {
  if (!Number.isInteger(pgrp) || pgrp <= 1) return true;
  let entries;
  try {
    entries = await readdir("/proc", { withFileTypes: true });
  } catch {
    // If procfs is unavailable, absence of evidence is not proof that a group is empty.
    return true;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const identity = await processIdentity(Number(entry.name));
    if (identity?.pgrp === pgrp) return true;
  }
  return false;
}

async function probeTcp(port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () =>
      finish({ reachable: false, category: "timeout" }),
    );
    socket.once("connect", () =>
      finish({ reachable: true, category: "connected" }),
    );
    socket.once("error", () =>
      finish({ reachable: false, category: "connect_error" }),
    );
  });
}

async function probeLocalHttp(port, pathname, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    // Deliberately do not parse or persist a response body: health is status-only telemetry.
    void response.body?.cancel().catch(() => undefined);
    return { reachable: true, status: response.status, category: "response" };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      category: error?.name === "AbortError" ? "timeout" : "request_error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function healthyHttpResponse(probe) {
  return Boolean(
    probe.reachable &&
    probe.status !== null &&
    probe.status >= 200 &&
    probe.status < 300,
  );
}

function healthyLiveness(probe, probeType) {
  return probeType === "tcp" ? probe.reachable : healthyHttpResponse(probe);
}

export function createDefaultServices(projectDir = DEFAULT_PROJECT_DIR) {
  return [
    {
      name: "api",
      port: 3000,
      command: path.join(projectDir, "node_modules", ".bin", "tsx"),
      args: ["watch", "server/_core/index.ts"],
      cwd: projectDir,
      probe: "http",
      readiness: true,
      heapMiB: 768,
      rssLimitBytes: 768 * MiB,
      env: { PORT: "3000", NODE_ENV: "development" },
    },
    {
      name: "metro",
      port: 8081,
      command: path.join(projectDir, "node_modules", ".bin", "expo"),
      args: ["start", "--web", "--port", "8081"],
      cwd: projectDir,
      probe: "tcp",
      readiness: false,
      heapMiB: 2048,
      rssLimitBytes: 2048 * MiB,
      env: {
        EXPO_USE_METRO_WORKSPACE_ROOT: "1",
        EXPO_PORT: "8081",
        NODE_ENV: "development",
      },
    },
  ];
}

function boundedNodeOptions(existing, heapMiB) {
  const withoutHeap = String(existing ?? "")
    .split(/\s+/)
    .filter(
      (value) => value && !/^--max[-_]old[-_]space[-_]size(?:=|$)/.test(value),
    );
  withoutHeap.push(`--max-old-space-size=${heapMiB}`);
  return withoutHeap.join(" ");
}

function childEnvironment(service) {
  const inherited = service.cleanEnvironment ? {} : { ...process.env };
  delete inherited.CI;
  delete inherited.DATABASE_URL;
  delete inherited.DRIZZLE_DATABASE_URL;
  const environment = {
    ...inherited,
    ...service.env,
    DOTENV_CONFIG_PATH: "/dev/null",
    NODE_OPTIONS: boundedNodeOptions(inherited.NODE_OPTIONS, service.heapMiB),
  };
  delete environment.CI;
  delete environment.DATABASE_URL;
  delete environment.DRIZZLE_DATABASE_URL;
  return environment;
}

class PrivateEventLog {
  constructor(directory, options = {}) {
    this.directory = directory;
    this.file = path.join(directory, EVENT_LOG_NAME);
    this.maxBytes = options.maxBytes ?? DEFAULT_LOG_MAX_BYTES;
    this.maxFiles = options.maxFiles ?? DEFAULT_LOG_FILES;
  }

  async rotateIfNeeded(nextBytes) {
    try {
      const entry = await lstat(this.file);
      if (!entry.isFile() || entry.isSymbolicLink()) return;
      if (entry.size + nextBytes <= this.maxBytes) return;
      for (let index = this.maxFiles - 2; index >= 1; index -= 1) {
        const source = `${this.file}.${index}`;
        const target = `${this.file}.${index + 1}`;
        try {
          await rename(source, target);
          await chmod(target, 0o600);
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      }
      await rename(this.file, `${this.file}.1`);
      await chmod(`${this.file}.1`, 0o600);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  async append(event) {
    const line = `${JSON.stringify(event)}\n`;
    try {
      await ensurePrivateDirectory(this.directory);
      await this.rotateIfNeeded(Buffer.byteLength(line));
      await appendFile(this.file, line, { encoding: "utf8", mode: 0o600 });
      await chmod(this.file, 0o600);
    } catch {
      // Logging must never crash or restart a service, and errors are not logged recursively.
    }
  }
}

function sanitizeEvent(event) {
  const result = { at: fixedString(event.at, 40) ?? new Date().toISOString() };
  for (const key of ["event", "service", "reason", "category", "state"]) {
    const value = fixedString(event[key]);
    if (value !== null) result[key] = value;
  }
  for (const key of [
    "generation",
    "pid",
    "port",
    "status",
    "attempt",
    "rssBytes",
  ]) {
    const value = event[key];
    if (Number.isSafeInteger(value) && value >= 0) result[key] = value;
  }
  const code = safeExitCode(event.exitCode);
  const signal = safeSignal(event.signal);
  if (code !== null) result.exitCode = code;
  if (signal !== null) result.signal = signal;
  return result;
}

export async function readSupervisorStatus(stateDir = DEFAULT_STATE_DIR) {
  const status = await readPrivateJson(path.join(stateDir, STATUS_NAME));
  if (!status || typeof status !== "object" || status.schema !== 1) {
    return { found: false, state: null };
  }
  return { found: true, state: status };
}

async function acquireLock(directory, owner) {
  await ensurePrivateDirectory(directory);
  const file = path.join(directory, LOCK_NAME);
  const body = JSON.stringify(owner);
  try {
    const handle = await open(file, "wx", 0o600);
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(file, 0o600);
    return file;
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
  }

  const existing = await readPrivateJson(file);
  if (
    !existing ||
    !Number.isInteger(existing.pid) ||
    existing.pid <= 1 ||
    typeof existing.startTicks !== "string"
  ) {
    // An unreadable/corrupt lock is not proof that no owner exists, so fail closed.
    throw new SupervisorBusyError();
  }
  const identity = await processIdentity(existing.pid);
  if (
    identity &&
    (existing.startTicks === "unavailable" ||
      identity.startTicks === existing.startTicks)
  ) {
    throw new SupervisorBusyError();
  }
  if (!identity) {
    try {
      process.kill(existing.pid, 0);
      throw new SupervisorBusyError();
    } catch (error) {
      if (!error || error.code !== "ESRCH") throw error;
    }
  }

  // A missing PID or mismatched process-start tick proves the lock is stale; no PID is signalled.
  await removeIfPresent(file);
  return acquireLock(directory, owner);
}

async function releaseLock(file, instanceId) {
  const current = await readPrivateJson(file);
  if (current?.instanceId === instanceId) await removeIfPresent(file);
}

function defaultClock() {
  return { now: () => Date.now() };
}

function defaultSpawn(command, args, options) {
  return nodeSpawn(command, args, options);
}

function safeServiceName(name) {
  if (typeof name !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(name)) {
    throw new Error("Supervisor service name is invalid");
  }
  return name;
}

function serviceRuntime(spec) {
  return {
    spec,
    generation: 0,
    child: null,
    restartTimer: null,
    plannedRestart: null,
    restartTimes: [],
    circuitOpen: false,
    livenessFailures: 0,
    rssOverLimitSamples: 0,
    lastHealth: {
      liveness: "unknown",
      readiness: "unknown",
      at: null,
      status: null,
    },
    lastExit: null,
    lastRss: null,
  };
}

function childView(runtime) {
  const child = runtime.child;
  return {
    name: runtime.spec.name,
    port: runtime.spec.port,
    generation: runtime.generation,
    child: child
      ? {
          pid: child.pid,
          startedAt: child.startedAt,
          processStartTicks: child.identity?.startTicks ?? null,
          ownedGroupVerified: Boolean(
            child.identity && child.identity.pgrp === child.pid,
          ),
        }
      : null,
    restartPending: Boolean(runtime.restartTimer),
    circuitOpen: runtime.circuitOpen,
    livenessFailures: runtime.livenessFailures,
    readiness: runtime.lastHealth.readiness,
    liveness: runtime.lastHealth.liveness,
    healthStatus: runtime.lastHealth.status,
    healthAt: runtime.lastHealth.at,
    lastRssBytes: runtime.lastRss?.totalBytes ?? null,
    lastRssProcessCount: runtime.lastRss?.processCount ?? null,
    lastExit: runtime.lastExit,
  };
}

/**
 * Foreground-only owner for the project API and Metro process groups. It never discovers or adopts
 * arbitrary processes: child identity is PID + /proc start tick + detached process group.
 */
export class DevSupervisor {
  constructor(options = {}) {
    const projectDir = path.resolve(options.projectDir ?? DEFAULT_PROJECT_DIR);
    const suppliedServices =
      options.services ?? createDefaultServices(projectDir);
    if (!Array.isArray(suppliedServices) || suppliedServices.length === 0) {
      throw new Error("Supervisor requires at least one service");
    }
    const names = new Set();
    this.services = suppliedServices.map((raw) => {
      const name = safeServiceName(raw.name);
      if (names.has(name))
        throw new Error("Supervisor service names must be unique");
      names.add(name);
      if (!Array.isArray(raw.args) || typeof raw.command !== "string") {
        throw new Error("Supervisor service command is invalid");
      }
      return serviceRuntime({
        ...raw,
        name,
        cwd: path.resolve(raw.cwd ?? projectDir),
        probe: raw.probe === "tcp" ? "tcp" : "http",
        readiness: raw.readiness === true,
        heapMiB: Number.isInteger(raw.heapMiB) ? raw.heapMiB : 512,
        rssLimitBytes: Number.isSafeInteger(raw.rssLimitBytes)
          ? raw.rssLimitBytes
          : null,
      });
    });
    this.projectDir = projectDir;
    this.stateDir = path.resolve(options.stateDir ?? DEFAULT_STATE_DIR);
    this.clock = options.clock ?? defaultClock();
    this.spawn = options.spawn ?? defaultSpawn;
    this.resourceSampler = options.resourceSampler ?? sampleSystemResources;
    this.rssSampler = options.rssSampler ?? ownedProcessGroupRss;
    this.options = {
      intervalMs: options.intervalMs ?? 5_000,
      probeTimeoutMs: options.probeTimeoutMs ?? 1_500,
      startupGraceMs: options.startupGraceMs ?? 20_000,
      consecutiveFailures: options.consecutiveFailures ?? 3,
      rssConsecutiveSamples: options.rssConsecutiveSamples ?? 3,
      restartBaseMs: options.restartBaseMs ?? 1_000,
      restartMaxMs: options.restartMaxMs ?? 30_000,
      restartWindowMs: options.restartWindowMs ?? 10 * 60_000,
      retryCap: options.retryCap ?? 5,
      drainTimeoutMs: options.drainTimeoutMs ?? 10_000,
      systemMemoryWarnBytes: options.systemMemoryWarnBytes ?? 256 * MiB,
      logMaxBytes: options.logMaxBytes ?? DEFAULT_LOG_MAX_BYTES,
      logFiles: options.logFiles ?? DEFAULT_LOG_FILES,
    };
    this.eventLog = new PrivateEventLog(this.stateDir, {
      maxBytes: this.options.logMaxBytes,
      maxFiles: this.options.logFiles,
    });
    this.instanceId = randomUUID();
    this.ownerIdentity = null;
    this.lockFile = null;
    this.interval = null;
    this.operation = Promise.resolve();
    this.pollQueued = false;
    this.started = false;
    this.stopping = false;
    this.stopPromise = null;
    this.resolveStopped = null;
    this.stopped = new Promise((resolve) => {
      this.resolveStopped = resolve;
    });
    this.previousCpu = null;
    this.resources = null;
    this.systemPressure = null;
    this.history = [];
  }

  async start() {
    if (this.started) return;
    this.started = true;
    try {
      const identity = await processIdentity(process.pid);
      if (!identity || identity.pid !== process.pid) {
        throw new Error(
          "Supervisor requires Linux procfs process identity before spawning children",
        );
      }
      this.ownerIdentity = {
        pid: process.pid,
        startTicks: identity.startTicks,
        instanceId: this.instanceId,
        createdAt: nowIso(this.clock),
      };
      this.lockFile = await acquireLock(this.stateDir, this.ownerIdentity);
      await assertPortsAvailable(this.services.map((service) => service.spec));
      await this.record({ event: "supervisor_started", state: "foreground" });
      for (const service of this.services) {
        await this.startService(service, "initial");
      }
      await this.poll();
      this.interval = setInterval(() => {
        this.schedulePoll();
      }, this.options.intervalMs);
      await this.persist();
    } catch (error) {
      await this.cleanupAfterFailedStart();
      throw error;
    }
  }

  wait() {
    return this.stopped;
  }

  async stop(reason = "intentional_stop") {
    if (this.stopPromise) return this.stopPromise;
    // Mark the intent before queued telemetry/restart work can run; no child can be resurrected
    // between signal receipt and the orderly drain below.
    this.stopping = true;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const service of this.services) {
      if (service.restartTimer) clearTimeout(service.restartTimer);
      service.restartTimer = null;
    }
    this.stopPromise = this.enqueue(async () => {
      await this.record({
        event: "supervisor_stopping",
        reason,
        state: "intentional",
      });
      await Promise.all(
        this.services.map((service) => this.stopOwnedService(service)),
      );
      await this.record({
        event: "supervisor_stopped",
        reason,
        state: "intentional",
      });
      await this.persist("stopped");
      if (this.lockFile) await releaseLock(this.lockFile, this.instanceId);
      this.lockFile = null;
      this.resolveStopped?.();
    });
    return this.stopPromise;
  }

  async status() {
    return this.statusView();
  }

  async pollNow() {
    await this.enqueue(() => this.poll());
  }

  schedulePoll() {
    if (this.stopping || this.pollQueued) return;
    this.pollQueued = true;
    void this.enqueue(async () => {
      try {
        await this.poll();
      } finally {
        this.pollQueued = false;
      }
    });
  }

  async cleanupAfterFailedStart() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const service of this.services) {
      if (service.restartTimer) clearTimeout(service.restartTimer);
      service.restartTimer = null;
    }
    await Promise.all(
      this.services.map((service) => this.stopOwnedService(service)),
    );
    if (this.lockFile) await releaseLock(this.lockFile, this.instanceId);
    this.lockFile = null;
    this.stopping = true;
    this.resolveStopped?.();
  }

  enqueue(operation) {
    this.operation = this.operation
      .then(operation, operation)
      .catch(async () => {
        await this.record({
          event: "supervisor_internal_error",
          category: "contained",
        });
      });
    return this.operation;
  }

  async record(event) {
    const sanitized = sanitizeEvent({
      ...event,
      at: event.at ?? nowIso(this.clock),
    });
    this.history.push(sanitized);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    await this.eventLog.append(sanitized);
  }

  statusView(mode = this.stopping ? "stopped" : "supervising") {
    return {
      schema: 1,
      mode,
      instanceId: this.instanceId,
      supervisor: {
        pid: process.pid,
        startedAt: this.ownerIdentity?.createdAt ?? null,
        processStartTicks: this.ownerIdentity?.startTicks ?? null,
      },
      updatedAt: nowIso(this.clock),
      ports: this.services.map((service) => ({
        name: service.spec.name,
        port: service.spec.port,
      })),
      resources: this.resources,
      services: this.services.map(childView),
      history: this.history,
    };
  }

  async persist(mode) {
    try {
      await writePrivateAtomic(
        path.join(this.stateDir, STATUS_NAME),
        `${JSON.stringify(this.statusView(mode), null, 2)}\n`,
      );
    } catch {
      // State persistence is best-effort; the owned processes remain under this foreground parent.
    }
  }

  async startService(service, reason) {
    if (this.stopping || service.circuitOpen || service.child) return;
    let child;
    try {
      child = this.spawn(service.spec.command, service.spec.args, {
        cwd: service.spec.cwd,
        env: childEnvironment(service.spec),
        detached: true,
        stdio: "ignore",
        shell: false,
        windowsHide: true,
      });
    } catch {
      await this.record({
        event: "spawn_failed",
        service: service.spec.name,
        reason: "spawn_error",
      });
      await this.scheduleRestart(service, "spawn_error");
      return;
    }

    const pid = Number.isInteger(child.pid) && child.pid > 1 ? child.pid : null;
    const runtimeChild = {
      process: child,
      pid,
      startedAt: nowIso(this.clock),
      startedMs: this.clock.now(),
      identity: null,
      exitObserved: false,
    };
    // Spawn can report ENOENT or emit exit before procfs identity capture completes. Bind both
    // handlers synchronously so those child-level failures stay inside the restart circuit.
    child.once("error", () => {
      void this.enqueue(() => this.onChildError(service, runtimeChild));
    });
    child.once("exit", (code, signal) => {
      runtimeChild.exitObserved = true;
      void this.enqueue(() =>
        this.onChildExit(service, runtimeChild, code, signal),
      );
    });

    if (pid === null) {
      await this.record({
        event: "spawn_failed",
        service: service.spec.name,
        reason: "missing_pid",
      });
      await this.scheduleRestart(service, "missing_pid");
      return;
    }

    service.generation += 1;
    runtimeChild.generation = service.generation;
    service.child = runtimeChild;
    runtimeChild.identity = await this.captureOwnedIdentity(pid);
    // The synchronously-bound exit handler may already have cleared this reference and arranged
    // a bounded retry while identity capture was reading procfs.
    if (service.child !== runtimeChild) return;
    await this.record({
      event: "child_spawned",
      service: service.spec.name,
      reason,
      pid,
      generation: service.generation,
      port: service.spec.port,
    });
  }

  async captureOwnedIdentity(pid) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const identity = await processIdentity(pid);
      if (identity?.pgrp === pid) return identity;
      if (attempt < 2) await sleep(10);
    }
    return null;
  }

  async onChildError(service, child) {
    await this.record({
      event: "child_error",
      service: service.spec.name,
      generation: child.generation,
      category: "spawn_or_runtime_error",
    });
    // A child with no usable PID cannot be identified or signalled. Its synchronous error listener
    // still makes ENOENT a bounded restart failure rather than an unhandled parent-process error.
    if (child.pid === null && !this.stopping) {
      await this.scheduleRestart(service, "spawn_error");
    }
  }

  async onChildExit(service, child, code, signal) {
    if (child.pid === null) {
      await this.record({
        event: "child_exit",
        service: service.spec.name,
        exitCode: code,
        signal,
        reason: this.stopping ? "intentional_stop" : "missing_pid",
      });
      if (!this.stopping) await this.scheduleRestart(service, "missing_pid");
      await this.persist();
      return;
    }
    if (service.child !== child) return;
    service.child = null;
    service.lastExit = {
      at: nowIso(this.clock),
      exitCode: safeExitCode(code),
      signal: safeSignal(signal),
    };
    const planned = service.plannedRestart;
    service.plannedRestart = null;
    await this.record({
      event: "child_exit",
      service: service.spec.name,
      pid: child.pid,
      generation: service.generation,
      exitCode: code,
      signal,
      reason:
        planned ?? (this.stopping ? "intentional_stop" : "unexpected_exit"),
    });
    if (!this.stopping) {
      // An exit event is proof this exact spawned root ended, but is not authority to signal its
      // former group without an identity. Retrying is safe only once procfs proves that group empty.
      if (await processGroupHasMembers(child.pid)) {
        service.circuitOpen = true;
        await this.record({
          event: "circuit_open",
          service: service.spec.name,
          reason: "owned_group_not_proven_empty",
        });
      } else {
        await this.scheduleRestart(service, planned ?? "unexpected_exit");
      }
    }
    await this.persist();
  }

  async poll() {
    if (this.stopping) return;
    try {
      const resources = await this.resourceSampler(
        this.projectDir,
        this.previousCpu,
        this.clock,
      );
      if (resources?.cpu?.counter) this.previousCpu = resources.cpu.counter;
      this.resources = resources ?? null;
      await this.warnForSystemPressure();
    } catch {
      this.resources = null;
      await this.record({ event: "resource_sample", category: "unavailable" });
    }
    for (const service of this.services) {
      await this.pollService(service);
    }
    await this.persist();
  }

  async warnForSystemPressure() {
    const memory = this.resources?.memory;
    const available =
      memory?.cgroupAvailableBytes ?? memory?.availableBytes ?? null;
    const loadOne = this.resources?.cpu?.load?.one ?? null;
    const cores = this.resources?.cpu?.cores ?? null;
    const pressure =
      (Number.isFinite(available) &&
        available <= this.options.systemMemoryWarnBytes) ||
      (Number.isFinite(loadOne) &&
        Number.isInteger(cores) &&
        cores > 0 &&
        loadOne > cores * 2);
    if (pressure && !this.systemPressure) {
      this.systemPressure = "warn";
      await this.record({ event: "system_pressure", state: "warn" });
    } else if (!pressure && this.systemPressure) {
      this.systemPressure = null;
      await this.record({ event: "system_pressure", state: "clear" });
    }
  }

  async pollService(service) {
    if (this.stopping || service.circuitOpen || !service.child) return;
    const child = service.child;
    const identity = await processIdentity(child.pid);
    // The exit handler is attached before any async identity work. Let its queued, group-safe exit
    // path decide whether a restart is permissible instead of turning a rapid exit into lost ownership.
    if (service.child !== child || child.exitObserved) return;
    if (!child.identity && identity?.pgrp === child.pid)
      child.identity = identity;
    if (
      !sameIdentity(child.identity, identity) ||
      identity?.pgrp !== child.pid ||
      child.identity?.pgrp !== child.pid
    ) {
      await this.record({
        event: "owned_identity_lost",
        service: service.spec.name,
        pid: child.pid,
        generation: service.generation,
      });
      service.circuitOpen = true;
      await this.record({
        event: "circuit_open",
        service: service.spec.name,
        reason: "ownership_unverified",
      });
      return;
    }
    child.identity = identity;

    const liveness =
      service.spec.probe === "tcp"
        ? await probeTcp(service.spec.port, this.options.probeTimeoutMs)
        : await probeLocalHttp(
            service.spec.port,
            "/api/health",
            this.options.probeTimeoutMs,
          );
    const at = nowIso(this.clock);
    if (healthyLiveness(liveness, service.spec.probe)) {
      service.livenessFailures = 0;
      service.lastHealth = {
        liveness: "healthy",
        readiness: service.lastHealth.readiness,
        at,
        status: liveness.status ?? null,
      };
      if (service.spec.readiness) {
        const readiness = await probeLocalHttp(
          service.spec.port,
          "/api/ready",
          this.options.probeTimeoutMs,
        );
        const nextReadiness =
          readiness.reachable && readiness.status === 503
            ? "degraded"
            : readiness.reachable &&
                readiness.status !== null &&
                readiness.status >= 200 &&
                readiness.status < 300
              ? "ready"
              : "unknown";
        if (nextReadiness !== service.lastHealth.readiness) {
          await this.record({
            event:
              nextReadiness === "degraded"
                ? "readiness_degraded"
                : "readiness_state",
            service: service.spec.name,
            state: nextReadiness,
            status: readiness.status,
          });
        }
        service.lastHealth.readiness = nextReadiness;
      } else {
        service.lastHealth.readiness = "not_applicable";
      }
    } else {
      const withinGrace =
        this.clock.now() - child.startedMs < this.options.startupGraceMs;
      service.lastHealth = {
        liveness: withinGrace ? "starting" : "failed",
        readiness: "unknown",
        at,
        status: liveness.status ?? null,
      };
      if (!withinGrace) {
        service.livenessFailures += 1;
        await this.record({
          event: "liveness_failure",
          service: service.spec.name,
          category: liveness.category,
          status: liveness.status ?? undefined,
          attempt: service.livenessFailures,
        });
        if (service.livenessFailures >= this.options.consecutiveFailures) {
          await this.requestOwnedRestart(
            service,
            "consecutive_liveness_failure",
          );
          return;
        }
      }
    }

    if (service.child !== child || !child.identity) return;
    let rss = null;
    try {
      rss = await this.rssSampler(child.identity);
    } catch {
      rss = null;
    }
    service.lastRss = rss;
    if (
      rss &&
      service.spec.rssLimitBytes !== null &&
      rss.totalBytes >= service.spec.rssLimitBytes
    ) {
      service.rssOverLimitSamples += 1;
      if (service.rssOverLimitSamples >= this.options.rssConsecutiveSamples) {
        await this.record({
          event: "owned_rss_threshold",
          service: service.spec.name,
          rssBytes: rss.totalBytes,
        });
        await this.requestOwnedRestart(service, "owned_rss_threshold");
      }
    } else {
      service.rssOverLimitSamples = 0;
    }
  }

  async requestOwnedRestart(service, reason) {
    if (
      this.stopping ||
      service.circuitOpen ||
      service.plannedRestart ||
      !service.child
    ) {
      return;
    }
    service.plannedRestart = reason;
    const stopped = await this.terminateOwnedChild(service);
    if (!stopped && service.child) {
      // Identity changed or the group did not stop. It is never signalled or replaced again.
      service.plannedRestart = null;
      service.circuitOpen = true;
      await this.record({
        event: "circuit_open",
        service: service.spec.name,
        reason: `${reason}_ownership_unverified`,
      });
    }
  }

  async stopOwnedService(service) {
    service.plannedRestart = "intentional_stop";
    const child = service.child;
    await this.terminateOwnedChild(service);
    // terminateOwnedChild waits for the root child exit. Clear the owned reference before final
    // status persistence so its queued exit callback cannot resurrect private state after stop.
    if (service.child === child) service.child = null;
  }

  async terminateOwnedChild(service) {
    const child = service.child;
    if (!child || !child.identity) return false;
    const current = await processIdentity(child.pid);
    if (
      !sameIdentity(child.identity, current) ||
      current.pgrp !== child.pid ||
      child.identity.pgrp !== child.pid
    ) {
      await this.record({
        event: "signal_refused",
        service: service.spec.name,
        pid: child.pid,
        reason: "identity_or_group_unverified",
      });
      return false;
    }

    const waitForExit = this.waitForChildExit(
      child.process,
      this.options.drainTimeoutMs,
    );
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (!error || error.code !== "ESRCH") {
        await this.record({
          event: "signal_refused",
          service: service.spec.name,
          pid: child.pid,
          reason: "term_failed",
        });
        return false;
      }
    }
    if (await waitForExit) return true;

    const afterDrain = await processIdentity(child.pid);
    if (
      !sameIdentity(child.identity, afterDrain) ||
      afterDrain.pgrp !== child.pid
    ) {
      return false;
    }
    try {
      process.kill(-child.pid, "SIGKILL");
      await this.record({
        event: "child_force_killed",
        service: service.spec.name,
        pid: child.pid,
      });
      return await this.waitForChildExit(
        child.process,
        this.options.drainTimeoutMs,
      );
    } catch {
      return false;
    }
  }

  async waitForChildExit(child, timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        child.off("exit", onExit);
        resolve(value);
      };
      const onExit = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      child.once("exit", onExit);
    });
  }

  async scheduleRestart(service, reason) {
    if (
      this.stopping ||
      service.circuitOpen ||
      service.restartTimer ||
      service.child
    ) {
      return;
    }
    const now = this.clock.now();
    service.restartTimes = service.restartTimes.filter(
      (time) => now - time <= this.options.restartWindowMs,
    );
    if (service.restartTimes.length >= this.options.retryCap) {
      service.circuitOpen = true;
      await this.record({
        event: "circuit_open",
        service: service.spec.name,
        reason,
        attempt: service.restartTimes.length,
      });
      await this.persist();
      return;
    }
    service.restartTimes.push(now);
    const attempt = service.restartTimes.length;
    const delay = Math.min(
      this.options.restartMaxMs,
      this.options.restartBaseMs * 2 ** Math.max(0, attempt - 1),
    );
    await this.record({
      event: "restart_scheduled",
      service: service.spec.name,
      reason,
      attempt,
    });
    service.restartTimer = setTimeout(() => {
      service.restartTimer = null;
      void this.enqueue(async () => {
        if (!this.stopping && !service.circuitOpen && !service.child) {
          await this.startService(service, reason);
          await this.persist();
        }
      });
    }, delay);
  }
}

/**
 * @param {Array<{
 *   name: string,
 *   port: number,
 *   probe: string,
 *   readiness: boolean,
 * }>} [services]
 */
export async function observeOnce(services = createDefaultServices()) {
  const resources = await sampleSystemResources(DEFAULT_PROJECT_DIR);
  const observations = [];
  for (const service of services) {
    const liveness =
      service.probe === "tcp"
        ? await probeTcp(service.port, 1_500)
        : await probeLocalHttp(service.port, "/api/health", 1_500);
    let readiness = "not_applicable";
    if (service.readiness) {
      const probe = await probeLocalHttp(service.port, "/api/ready", 1_500);
      readiness =
        probe.reachable && probe.status === 503
          ? "degraded"
          : probe.reachable &&
              probe.status !== null &&
              probe.status >= 200 &&
              probe.status < 300
            ? "ready"
            : "unknown";
    }
    observations.push({
      name: service.name,
      port: service.port,
      liveness: healthyLiveness(liveness, service.probe)
        ? "healthy"
        : liveness.reachable
          ? "unhealthy"
          : "unreachable",
      healthStatus: liveness.status ?? null,
      readiness,
    });
  }
  return {
    sampledAt: new Date().toISOString(),
    resources,
    services: observations,
  };
}

export function observationExitCode(observation) {
  return observation.services.some((service) => service.liveness !== "healthy")
    ? 2
    : 0;
}
