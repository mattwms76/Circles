# Trusted runtime recovery

## Diagnose configuration drift without exposing it

A healthy listener/HTML page can coexist with failed database queries. Compare public root, superficial health and actual list/detail RPC responses. Capture status and redacted categories rather than returned SQL/driver detail. Reload a browser before assuming cached posts establish readiness.

Use the current project's injected runtime value for a read-only fresh connection. If necessary, compare it with the identified running service's value using equality booleans only, or make one authorized read-only old-setting check. Do not dump process environments, systemd/PM2 environment output, secret-provider output or authenticated response content. Attribute an access-denied result accurately; do not guess who rotated settings or claim incident closure.

Confirm the ORM client type before recommending connection recovery. A new process succeeding while an old process fails can show environment drift; it is not automatically a stale single-connection bug. Never reset a database or rerun seeds to address rejected credentials.

## Managed Manus execution

A standalone Node script cannot directly use the Host's MCP/session-job controls. Discover the bound project's live tools, call `webdev.config` with `GET env`, require successful applied synchronization and launch new processes with an explicit bound project `cwd`. Configuration acceptance does not restart an existing process.

Inspect the actual service/job and listener identity before stopping it. Stop only the API service that uses the stale setting; keep Metro and unrelated processes. Start `pnpm dev:server` once with `service=true` and without CI, then verify fixed API 3000, Metro 8081 and the current public same-origin data requests. Do not turn off origin checks or replace safe relative browser URLs with internal Host-derived URLs.

Use the bundled utility's `--verify-only` mode after Host-managed recovery, with `--project-dir` pointing at the actual app and an explicitly supplied current public API/Preview origin. Verify-only must not export all runtime secrets, connect to the database or restart a process. Public HTTPS proxy ports are distinct from internal listener ports. Never hardcode an old session's address. Consult the actual `--help`; never invent a retired tool or a generic refresh-env CLI. If trusted sync fails, report the blocker instead of starting with stale values.

## Local operator execution

Use a protected runtime env file or an explicit trusted export adapter, and an existing named service manager/restart command. Require an intentional apply mode after dry-run. Treat configured argv as privileged operator input; do not reconstruct secrets into it. Hide export/stdout/stderr that could contain credential values.

PM2-style restart must update the process environment and preserve the existing manager's HOME/PM2_HOME so it cannot accidentally select a new empty manager. systemd-style restart only reloads settings when the unit actually references the fresh EnvironmentFile; passing env to `systemctl` does not inject it into a unit. Do not set machine-wide environment or kill by broad process-name match. Never leave an unmanaged background API after the utility exits.

Preflight configuration and actual database connectivity read-only before restart, with finite connection/query timeouts and guaranteed close. Preserve stable signing/app identity, because it may be coupled to stored media and tokens. If a patched app depends on a new durable session table, require schema-first readiness; the utility must not run the migration itself. A failed preflight must leave the current service untouched. Restrict private env/auth files to owner-only permissions; trusted executable adapters can have ordinary read/execute permissions but must not be group/world writable.

## Complete and incomplete endpoint coverage

Derive the reviewed read-only tRPC query inventory from current source. Report unknown/new routes as drift requiring a reviewed definition. Do not infer safe operation merely from HTTP GET: OAuth start/callback/mobile exchange can issue or change sessions; automatic probes must exclude those and all mutations. Storage/media reads require separately reviewed existing object keys. Verify response status/shape and use finite timeouts/body limits with structured redacted failure results. Reject redirects on bearer-bearing checks. Do not interpret a successful auth denial as a positive authorized-data test. Never execute create/join/send/like/read-ack/heartbeat mutations for setup.

Public reads can be exercised with no session. Protected reads need a real authorized bearer/cookie supplied privately and existing accessible IDs. Live signals/chat may require already-existing active participant context; an empty app cannot be populated just to make an audit pass. Missing credentials, absent owned context and unavailable active streams must be recorded as incomplete/skipped with reasons. Strict full-coverage mode must return nonzero for those gaps, even if every available public list succeeds.

Report separate counts for positive data reads, expected denial-gate checks, skipped/incomplete cases and failures. Do not say all endpoints verified when only root, health and three public lists ran. Keep raw app content and secrets out of the report.

## After a private PostgreSQL cutover

Verify the actual schema and primary driver from current source. For current Circles, use only `SUPABASE_DATABASE_URL`, its reviewed target-identity/TLS helper and `circles_app_runtime`. Retain `DATABASE_URL` solely as the original read-only MySQL/TiDB import/rollback source, exclude it from the API environment, and prevent `.env` from reintroducing it with `DOTENV_CONFIG_PATH=/dev/null` on the selected API command. Verify role-initialized queries and transactions plus private table/RLS/sequence readiness before restarting. Do not rerun import, seed, reset a database, or rotate login/signing identity during ordinary recovery. PostgreSQL writes make the old source stale; rollback then needs explicit reconciliation.
