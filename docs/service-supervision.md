# Circles development service supervision

`node scripts/dev-supervisor.mjs` is an **application-native, foreground** Node supervisor for the two fixed development listeners:

| Child | Fixed listener | Existing project command it runs from the project root               |
| ----- | -------------- | -------------------------------------------------------------------- |
| API   | `3000`         | `node_modules/.bin/tsx watch server/_core/index.ts` with `PORT=3000` |
| Metro | `8081`         | `node_modules/.bin/expo start --web --port 8081`                     |

It is intentionally not a deployment system, an external monitor, a schedule, a Trigger, a daemon installer, or a replacement for an authorized host service manager.

Foreground process control requires Linux with readable `/proc` PID/start-time identity. Startup refuses before spawning children if that identity is unavailable; this is not a native macOS/Windows process supervisor. The existing standalone Expo/API commands remain available.

## Safe invocation

Run these commands from the exact Circles project directory:

```sh
# Foreground supervisor. Launch through the authorized service/job facility with service=true.
node scripts/dev-supervisor.mjs

# A finite, read-only local observation. It starts and stops no child process.
node scripts/dev-supervisor.mjs --once

# Read private saved state only. It never starts a process or probes a listener.
node scripts/dev-supervisor.mjs --status

# No-op usage output; exit status 0.
node scripts/dev-supervisor.mjs --help
```

The foreground process is stopped by sending **SIGTERM** or **SIGINT to that exact supervisor job/process**. It drains each process group it created, waits up to ten seconds, and only then force-kills an identity-verified child group if needed. Do not use `pkill`, broad process-name matching, or a port-killing command. Those approaches can terminate unrelated work and are outside this supervisor's ownership model.

`--once` exits `0` when API liveness is 2xx and Metro's local TCP listener responds, or `2` when either is unreachable/unhealthy. An API health 500 is a failed liveness check, not success. API dependency readiness of `503` is reported as `degraded`, distinct from process liveness. `--status` exits `0` for valid private state and `3` when no valid owned state exists. `--help` never probes, locks, or spawns. Saved state is a last observation, not proof that its recorded supervisor PID is still alive; use `--once` plus an authorized service/process check for current availability.

Clean shutdown is recorded only after procfs verifies that every process in each identity-verified detached group has exited. If a root exits while a group member survives TERM, the supervisor observes that still-owned group, sends SIGKILL, and verifies emptiness before writing `stopped` or releasing its lock. If procfs cannot prove emptiness or a signal fails, state remains `draining` and the lock remains owned; the supervisor never reports a clean stop while an owned descendant may remain.

## Busy-port and lock behavior

Before it starts any child, the foreground supervisor takes a private lock and verifies both fixed local ports are available. It refuses to start when either port is already occupied, including by an existing manually launched API or Metro process. It **does not inspect, adopt, signal, or stop** that unknown process. It also refuses a live private lock from another supervisor; stale locks are removed only after the recorded PID's `/proc` start tick no longer matches, preventing PID-reuse mistakes.

An operator must first identify and intentionally stop only the known old API/Metro jobs. After confirming both listeners are free, start one supervisor. The supervisor never takes over current listeners on its own.

## What the foreground supervisor does

The supervisor creates a detached process group for each child it starts and records PID plus Linux process-start identity. It acts only when that identity and its own process group remain verified. Child output is connected to `ignore`: raw stdout/stderr, request bodies, environment values, credentials, profile data, and database rows are never copied to supervisor logs or status.

At bounded intervals it samples load/CPU, available host memory, cgroup-available memory where exposed, available disk, and aggregate RSS of each owned group. A metric that cannot be read is recorded as `null`, never fabricated as zero. Low system memory or high load becomes a warning only; it never resets the host or kills unrelated processes.

For child recovery, it uses a startup grace period, three consecutive failed local liveness checks, exponential restart backoff, a rolling retry cap, and a per-child circuit breaker. API `/api/ready` returning `503` is dependency degradation: it is recorded without a restart loop. Sustained RSS above the child-specific threshold can restart only an identity-verified owned group. Default limits are 768 MiB for the API and 2048 MiB for Metro, matching bounded Node heaps.

## Private local artifacts

While it is running, the supervisor writes `0600` structured status and bounded, rotating event logs under:

```text
artifacts/private/service-supervision/
```

The containing directory is restricted to `0700`. Status retains only bounded summaries such as timestamps, service name, PID, generation, sanitized exit/signal, health category, resource numbers, and restart/circuit state. There is no remote probe URL, webhook, DSN, command hook, or child-command configuration exposed by the public CLI.

## Activation boundaries and persistence limits

This sandbox can suspend or lose the entire terminal session, including the supervisor and its children. The script can recover a child crash **only while its foreground parent remains alive**. It cannot guarantee always-on monitoring, recovery after sandbox/session loss, host reboot recovery, or production readiness.

Use it only after an authorized operator has stopped the exact known resident development jobs and with the correct project working directory. It preserves fixed API `3000` and Metro `8081`, removes `CI`, `DATABASE_URL`, and `DRIZZLE_DATABASE_URL` from children, sets `DOTENV_CONFIG_PATH=/dev/null`, and preserves other inherited runtime values such as cookies/proxy configuration. It does not refresh provider/runtime configuration, alter a database, or verify authenticated data flows.

For an already-authorized persistent Linux host, see `operations/supervision/circles-preview.service.example`. That is a **template only**; review paths, user permissions, protected environment file ownership, and service-manager policy before an operator installs or enables it.

## Finite validation evidence

`tests/dev-supervisor.test.ts` launches only `env -i` synthetic Node children on ephemeral ports. Its 13 cases cover crash replacement, health restoration, immediate exit and spawn ENOENT handling, hang recovery, HTTP-500 liveness/one-shot behavior, readiness-503 no-churn behavior, retry circuit breaking, intentional stop/no resurrection, busy ports, live-lock refusal, secret-safe bounded logs, unavailable resources, and owned-RSS restart gating. The dedicated `tests/cba07-supervisor-group-drain.test.ts` adds a root-exits-first, TERM-ignoring same-group descendant drill and asserts force-kill, verified group drain, then clean stopped-state ordering. Its bounded crash-recovery drill preserves redacted evidence at:

```text
/home/ubuntu/circles-people-and-resilience-20261029/evidence/supervisor/synthetic-crash-recovery.json
```

The drill does not bind, stop, or restart the real API `3000` or Metro `8081` listeners.
