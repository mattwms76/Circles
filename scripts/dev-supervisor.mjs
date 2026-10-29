#!/usr/bin/env node
import {
  DevSupervisor,
  observationExitCode,
  observeOnce,
  readSupervisorStatus,
} from "./lib/dev-supervisor-core.mjs";

const HELP = `Circles development supervisor

Usage:
  node scripts/dev-supervisor.mjs            Foreground supervisor for API :3000 and Metro :8081
  node scripts/dev-supervisor.mjs --once     Read-only local telemetry and health observation
  node scripts/dev-supervisor.mjs --status   Read saved private supervisor status; never spawns children
  node scripts/dev-supervisor.mjs --help     Show this help without probing or spawning

The default foreground mode refuses busy API/Metro ports or another live supervisor.
It owns only children it starts and is not an always-on sandbox service.
`;

function usageError() {
  process.stderr.write("Unknown supervisor option. Use --help.\n");
  process.exitCode = 64;
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length > 1 ||
    (args.length === 1 &&
      !["--once", "--status", "--help", "-h"].includes(args[0]))
  ) {
    usageError();
    return;
  }
  const mode = args[0] ?? "foreground";
  if (mode === "--help" || mode === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (mode === "--once") {
    const observation = await observeOnce();
    process.stdout.write(`${JSON.stringify(observation, null, 2)}\n`);
    process.exitCode = observationExitCode(observation);
    return;
  }
  if (mode === "--status") {
    const status = await readSupervisorStatus();
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    if (!status.found) process.exitCode = 3;
    return;
  }

  const supervisor = new DevSupervisor();
  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    void supervisor.stop(`signal_${signal}`).catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("unhandledRejection", () => {
    process.exitCode = 1;
    stop("unhandled_rejection");
  });
  process.once("uncaughtException", () => {
    process.exitCode = 1;
    stop("uncaught_exception");
  });

  await supervisor.start();
  await supervisor.wait();
}

void main().catch(() => {
  // Details may include environment or child-command data and are intentionally not printed.
  process.stderr.write("Circles supervisor could not start safely.\n");
  process.exitCode = 1;
});
