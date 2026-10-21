# Guarded API refresh and data verification

`scripts/recover-api.mjs` is a **one-shot, dry-run-first** recovery utility. It derives the current tRPC query inventory from a specified Circles source checkout, performs only read-only checks, and can restart only the reviewed local service name. It is **not** a deployment tool: it never migrates or seeds a database, writes data, rotates keys, invokes a mutation, wildcard-kills a process, creates a service manager, or starts a detached process.

## Three deliberately separate modes

| Mode | Runtime/database preflight | Restart | API queries | Intended boundary |
| --- | --- | --- | --- | --- |
| Default / `--dry-run` | Full trusted runtime config, bounded read-only `SELECT 1`, and (when applicable) session-schema check | No | No | Plan an approved **local-manager** change. |
| `--apply` | Same full preflight as dry run | Only existing `circles-api` through the selected local manager/adapter | Yes, after bounded readiness | Local-manager recovery only. |
| `--verify-only` | **No database connection or session-schema inspection**; validates only a supplied/refreshed API origin | **Never** | Yes | Post-refresh/post-restart verification, including Host-managed Preview. |

`--apply`, `--dry-run`, and `--verify-only` are mutually exclusive when explicitly supplied. `--verify-only` rejects local restart and `--require-session-schema` options rather than silently ignoring them.

## Safety model

- **Internal restart boundary:** dry-run/apply require all runtime values, preserve API **3000** and Metro **8081**, and reject a Manus session hostname as an internal API target. This prevents a local restart from being redirected to another port or an arbitrary Preview URL.
- **Published verification boundary:** verify-only accepts a credential-free explicit HTTPS origin, including a current `*.manus.computer` Preview on public port **443**, or an origin read from a freshly supplied environment source. It does not hardcode a session address. Plain HTTP is accepted only for a loopback local API origin.
- Runtime settings for dry-run/apply come from exactly one selected dotenv file or exporter. A private dotenv/auth file must be a regular non-symlink file owned by the current user with no group/world permissions (`0600` is typical). A trusted exporter/restart executable may instead be normal owner-owned, non-group/world-writable `0755`.
- Dry-run/apply first validate config shape and identity continuity, then open one bounded project-local MySQL connection and issue only `SELECT 1 AS ready`. This applies even to an unpatched build. A durable-session build additionally uses bounded read-only `information_schema` queries to require `applicationSessions`, its `sessionFingerprint` primary key, and both reviewed indexes. Connections are closed in every outcome. No DDL or migration is performed.
- A downloaded/skill-bundled script uses `--project-dir` to read `server/` from the real source checkout and, for dry-run/apply only, resolve that checkout's existing `mysql2` dependency. `--project-dir` must be absolute. Verify-only remains dependency-free with respect to MySQL.
- Apply accepts only the service name `circles-api`. It uses an existing `systemd` or `pm2` manager, or a finite explicit restart-adapter executable. It uses no shell, PID input, wildcard `pkill`, or detached child process.
- PM2 uses `--update-env` **only** after it receives an explicit absolute `HOME` and `PM2_HOME` from the trusted reference environment. Their values are preserved exactly; the script never invents a machine-global PM2 location. An absent/relative/ambiguous manager context is refused, so the command cannot connect to or create a different PM2 manager.
- After a successful local restart, the utility retries the non-mutating public `social.feed` data read at most **3** times (500 ms between attempts) before it runs the final inventory. `/api/health` alone is not used as readiness proof.

## Host-managed refresh/restart, then verify-only

This standalone Node utility **does not and cannot call Host MCP or job-control tools**. Do not invent or invoke a fictional standalone `mcp` CLI. In Manus, the parent recovery skill/orchestrator must:

1. Call real Host `webdev.config` **GET env** and require the platform to apply the refreshed environment.
2. Restart only the known API job with `service=true` through Host control.
3. Run this script as verify-only against the **current public Preview/API origin**.

Verify-only needs no exported database URL, JWT secret, provider key, or session-schema access: Host has already preflighted/restarted the service. It needs an explicit public origin or a refreshed origin-only environment input, the absolute source checkout, and optionally private auth/manifest files.

```sh
# The preview origin comes from the current Host/operator result; do not reuse a past session URL.
node /secure/tools/recover-api.mjs --verify-only \
  --project-dir /srv/circles \
  --api-base-url https://<current-preview>.manus.computer \
  --auth-file /secure/circles/verify-auth.json \
  --endpoint-manifest /srv/circles/examples/recover-api.manifest.json \
  --strict
```

An origin may instead come from a **freshly obtained** selected environment source. That file can contain only the public-origin setting needed for verification; verify-only does not require the complete runtime configuration.

```sh
node /secure/tools/recover-api.mjs --verify-only \
  --project-dir /srv/circles \
  --env-file /secure/circles/refreshed-public-origin.env \
  --auth-file /secure/circles/verify-auth.json
```

## Dry-run workflow (local-manager path)

Start with a known trusted runtime source outside the repository. Both dry run and apply resolve MySQL from `--project-dir` (or the repository containing the script) and perform the bounded read-only database preflight before any possible restart.

```sh
node scripts/recover-api.mjs --dry-run \
  --project-dir /srv/circles \
  --env-file /secure/circles/runtime.env \
  --auth-file /secure/circles/verify-auth.json \
  --endpoint-manifest examples/recover-api.manifest.json
```

An exporter must be an absolute, trusted executable that emits only dotenv assignments on stdout. Do **not** put a provider token in its argv; arrange its credential through the provider's secure environment/agent mechanism.

```sh
node scripts/recover-api.mjs --dry-run \
  --project-dir /srv/circles \
  --env-command /secure/circles/export-runtime-env \
  --auth-file /secure/circles/verify-auth.json \
  --strict
```

Dry run reads/preflights the source and required database/session checks, derives the inventory, validates optional manifest/auth files, and prints a redacted JSON plan. It does **not** restart or call the API. Its data coverage is intentionally incomplete, so `--strict` returns nonzero in dry-run mode.

## Apply workflow (local manager only)

Run apply only after a successful dry run and normal change approval. These forms use an already-managed service; they do not create one.

```sh
# The systemd unit must use the same, freshly updated EnvironmentFile.
node scripts/recover-api.mjs --apply \
  --project-dir /srv/circles \
  --env-file /secure/circles/runtime.env \
  --service-name circles-api --service-manager systemd \
  --auth-file /secure/circles/verify-auth.json \
  --endpoint-manifest examples/recover-api.manifest.json --strict

# Both values name the already-running PM2 manager context; do not invent them.
HOME=/home/circles PM2_HOME=/home/circles/.pm2 \
node scripts/recover-api.mjs --apply \
  --project-dir /srv/circles \
  --env-file /secure/circles/runtime.env \
  --service-name circles-api --service-manager pm2 \
  --auth-file /secure/circles/verify-auth.json --strict
```

An explicit adapter is for an existing finite manager integration. It receives only `circles-api` as its argument, must wait for completion, and must not create a daemon:

```sh
node scripts/recover-api.mjs --apply \
  --project-dir /srv/circles \
  --env-file /secure/circles/runtime.env \
  --service-name circles-api --restart-adapter /secure/circles/restart-api \
  --auth-file /secure/circles/verify-auth.json --strict
```

Use `--api-base-url http://127.0.0.1:3000` or another known **internal port-3000** API origin only for dry-run/apply. A public/proxied Preview origin belongs to verify-only, not local restart mode.

## Verification inputs and coverage

The optional manifest is a bounded input override for **already source-derived query routes only**; it cannot add an endpoint or turn a mutation into a test. See [`examples/recover-api.manifest.json`](../examples/recover-api.manifest.json). New router queries or changed public/protected classification are reported as inventory drift and are not invoked until the script gets a reviewed definition.

For protected positive tests, supply an existing authorized bearer and IDs in a private local file:

```json
{
  "bearerToken": "replace-with-an-existing-session-token",
  "ids": {
    "circleId": 101,
    "profileId": 102,
    "postId": 103,
    "conversationId": 104,
    "streamId": 105
  }
}
```

Use a file such as `/secure/circles/verify-auth.json` with owner-only mode `0600`; do not commit it. The script never creates a user, circle, post, conversation, stream, or session. Missing auth, IDs, or active viewer context are **skipped/incomplete**, never passed. `--strict` exits nonzero for incomplete coverage or inventory drift. Protected procedures also receive a separately reported anonymous-denial gate check, so an expected unauthenticated denial is never confused with a positive authorized data read.

Current-source query inventory is:

| Router | Query procedures | Positive input source |
| --- | --- | --- |
| `auth` | `me` | Bearer file; anonymous state is checked separately |
| `social` | `feed`, `circles`, `circle`, `profiles`, `profile`, `members`, `comments`, `conversations`, `messages` | Safe defaults plus existing `circleId`/`profileId`/`postId`/`conversationId` as required |
| `live` | `list`, `signals`, `chat` | Safe default plus existing `streamId` for protected reads |
| `system` | `health` | Safe timestamp input; supplementary only |

Each API request is a finite-timeout `GET /api/trpc/<query>` with `redirect: "error"` and a 64 KiB response limit. A redirect is never followed, so a bearer is never sent to a redirected origin. Network, malformed, truncated, and oversized responses become redacted result categories; response bodies, SQL diagnostics, cookies, DSNs, bearer tokens, config values, and private paths are not printed. `social.feed`, `social.circles`, and `live.list` are the final public data readiness checks.

**Automatic scope is deliberately narrower than HTTP GET.** The utility calls only reviewed, source-derived tRPC `.query()` procedures. It never auto-probes OAuth start/callback/mobile/session-exchange endpoints, logout, storage/media proxy routes, or any route that can set state, issue/clear a session, or depend on an arbitrary object key. It also never calls `live.join`, `live.heartbeat`, `live.leave`, signaling writes, or a social mutation to manufacture a live/viewer context.

## Exit status and limits

- `0`: allowed preflight/restart/verification completed without failures; in strict mode coverage was complete.
- `1`: rejected configuration/target/private input/database/schema, failed restart/readiness/query/shape, or strict incomplete/inventory-drift coverage.
- `2`: invalid/ambiguous CLI arguments.

The focused tests use only synthetic fetch responses, injected restart/database adapters, mocked MySQL modules, a copied bundled script, and temporary local files. They do not access a real database, provider, service manager, browser, auth session, Host deployment, or deployed Preview. Passing tests or this utility does not apply a migration or prove real OAuth, durable-session data, provider connectivity, or actual production service state.
