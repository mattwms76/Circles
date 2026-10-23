# Guarded API refresh and data verification

`scripts/recover-api.mjs` is a **one-shot, dry-run-first** recovery utility. It derives the current tRPC query inventory from a specified Circles source checkout, performs only read-only checks, and can restart only the reviewed local service name. It is **not** a deployment tool: it never migrates or seeds a database, writes data, rotates keys, invokes a mutation, wildcard-kills a process, creates a service manager, or starts a detached process.

## Three deliberately separate modes

| Mode                  | Runtime/database preflight                                                                              | Restart                                                                | API queries                  | Intended boundary                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| Default / `--dry-run` | Full trusted runtime config, bounded read-only PostgreSQL readiness and private-schema catalog checks   | No                                                                     | No                           | Plan an approved **local-manager** change.                              |
| `--apply`             | Same full preflight as dry run                                                                          | Only existing `circles-api` through the selected local manager/adapter | Yes, after bounded readiness | Local-manager recovery only.                                            |
| `--verify-only`       | **No database connection or session-schema inspection**; validates only a supplied/refreshed API origin | **Never**                                                              | Yes                          | Post-refresh/post-restart verification, including Host-managed Preview. |

`--apply`, `--dry-run`, and `--verify-only` are mutually exclusive when explicitly supplied. `--verify-only` rejects local restart and `--require-session-schema` options rather than silently ignoring them.

## Safety model

- **Internal restart boundary:** dry-run/apply require all runtime values and preserve API **3000** and Metro **8081**. An explicit API target must be a canonical loopback `:3000` origin or an exact canonical match for the trusted configured API origin; an arbitrary remote `--api-base-url` is refused before any auth file is read. Temporary Manus session hosts remain invalid restart targets.
- **Published verification boundary:** verify-only keeps public HTTPS Preview verification separate from internal API **3000**. An unauthenticated check may use an explicit canonical HTTPS origin (or loopback HTTP); when an auth file/bearer is present, a public target must exactly equal the canonical API origin supplied by the trusted selected configuration. This permits the current trusted Preview without accepting every `*.manus.computer` host. Plain HTTP is accepted only for loopback.
- Runtime settings for dry-run/apply come from exactly one selected dotenv file or exporter. A private dotenv/auth file must be a regular non-symlink file owned by the current user with no group/world permissions (`0600` is typical). A trusted exporter/restart executable may instead be normal owner-owned, non-group/world-writable `0755`.
- Dry-run/apply first validate config shape and identity continuity, then use project-local `pg` plus the reviewed PostgreSQL helper for one bounded `current_database()` readiness read and seven bounded private-schema catalog reads: runtime-role attributes, app-schema usage, required columns, RLS/DML grants, exact runtime RLS policies, session indexes, and the complete identity-sequence ownership/privilege inventory. The policy inventory requires every named runtime policy and its command/role/`USING`/`WITH CHECK` shape, including the `_dataMigrations` SELECT-only policy. The sequence inventory requires the exact 17 reviewed identity sequences, ownership by each table's `id`, runtime `USAGE`/`SELECT`, and no runtime `UPDATE`. Connections are closed in every outcome. No app rows, DDL, migration, or provider mutation is performed.
- A downloaded/skill-bundled script uses `--project-dir` to read `server/` from the real source checkout and, for dry-run/apply only, resolve that checkout's existing `pg` dependency and `postgres-config.mjs` helper. `--project-dir` must be absolute. Verify-only remains database-driver independent.
- Apply accepts only the service name `circles-api`. It uses an existing `systemd` or `pm2` manager, or a finite explicit restart-adapter executable. It uses no shell, PID input, wildcard `pkill`, or detached child process.
- PM2 uses `--update-env` **only** after it receives an explicit absolute `HOME` and `PM2_HOME` from the trusted reference environment. Their values are preserved exactly; the script never invents a machine-global PM2 location. An absent/relative/ambiguous manager context is refused, so the command cannot connect to or create a different PM2 manager.
- After a successful local restart, the utility retries the non-mutating public `social.feed` data read at most **3** times (500 ms between attempts) before it runs the final inventory. `/api/health` alone is not used as readiness proof.

## Host-managed refresh/restart, then verify-only

This standalone Node utility **does not and cannot call Host MCP or job-control tools**. Do not invent or invoke a fictional standalone `mcp` CLI. In Manus, the parent recovery skill/orchestrator must:

1. Call real Host `webdev.config` **GET env** and require the platform to apply the refreshed environment.
2. Restart only the known API job with `service=true` through Host control.
3. Run this script as verify-only against the **current public Preview/API origin**.

Verify-only needs no exported database URL, JWT secret, provider key, or session-schema access: Host has already preflighted/restarted the service. It needs the absolute source checkout and an explicit canonical public origin. If using a private auth file, provide a freshly selected trusted configuration containing the same canonical `EXPO_PUBLIC_API_BASE_URL`; a bare arbitrary public origin is deliberately rejected before that file is opened.

```sh
# The preview origin comes from the current Host/operator result; do not reuse a past session URL.
node /secure/tools/recover-api.mjs --verify-only \
  --project-dir /srv/circles \
  --api-base-url https://<current-preview>.manus.computer \
  --env-file /secure/circles/refreshed-public-origin.env \
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

Start with a known trusted runtime source outside the repository. Both dry run and apply resolve PostgreSQL from `--project-dir` (or the repository containing the script) and perform the bounded read-only database/catalog preflight before any possible restart.

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

Use `--api-base-url http://127.0.0.1:3000` for loopback dry-run/apply, or omit it to use the trusted configured API origin. A non-loopback explicit `:3000` origin must exactly match that trusted configuration; a public/proxied Preview origin belongs to verify-only, not local restart mode.

## Verification inputs and coverage

The optional manifest is a bounded input override for **already source-derived query routes only**; it cannot add an endpoint or turn a mutation into a test. See [`examples/recover-api.manifest.json`](../examples/recover-api.manifest.json). Its checked-in `live.signals` entry intentionally has empty input: it demonstrates the supported route without committing a stale session generation. New router queries or changed public/protected classification are reported as inventory drift and are not invoked until the script gets a reviewed definition.

For protected positive tests, supply an existing authorized bearer and IDs in a private local file:

```json
{
  "bearerToken": "replace-with-an-existing-session-token",
  "ids": {
    "circleId": 101,
    "profileId": 102,
    "postId": 103,
    "conversationId": 104,
    "streamId": 105,
    "liveGeneration": 106
  },
  "activeLiveContext": {
    "streamId": 105,
    "generation": 106
  }
}
```

Use a file such as `/secure/circles/verify-auth.json` with owner-only mode `0600`; do not commit it. The bearer makes the whole file private even though IDs and generation are non-secret metadata.

`live.signals` and `live.relay` always take `streamId` from the trusted auth file and require a **current positive integer** `ids.liveGeneration` for that stream and active caller session. Their positive checks additionally require the matching `activeLiveContext` attestation; `live.chat` requires the same stream context. A reviewed manifest may instead provide a current numeric positive `endpoints["live.signals"].input.generation`, which overrides `ids.liveGeneration` for that one run, but it does not replace the active-context attestation. The verifier constructs exactly this input and does not add a default generation or cursor:

```json
{
  "streamId": 105,
  "generation": 106
}
```

Media generations change when participants join or reload. Therefore, no static checked-in manifest literal is a substitute for obtaining the caller's current stream/generation context immediately before the verify-only run. A missing generation yields `missing_current_live_generation`; a supplied non-positive/non-integer generation yields `invalid_current_live_generation`; a missing/mismatched active-context attestation yields `missing_active_live_context`. These are **incomplete**, not failed, and `--strict` exits nonzero. With an attestation, a live denial remains a failed positive check because it then indicates a real authorization/context inconsistency rather than missing verification scope.

The script never creates a user, circle, post, conversation, stream, or session. Missing auth, IDs, or active viewer context are **skipped/incomplete**, never passed. `--strict` exits nonzero for incomplete coverage or inventory drift. Protected procedures also receive a separately reported anonymous-denial gate check, so an expected unauthenticated denial is never confused with a positive authorized data read.

Current-source query inventory is:

| Router   | Query procedures                                                                                       | Positive input source                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth`   | `me`                                                                                                   | Bearer file; anonymous state is checked separately                                                                                                                             |
| `social` | `feed`, `circles`, `circle`, `profiles`, `profile`, `members`, `comments`, `conversations`, `messages` | Safe defaults plus existing `circleId`/`profileId`/`postId`/`conversationId` as required                                                                                       |
| `live`   | `list`, `signals`, `relay`, `chat`                                                                     | Safe default; `chat` uses existing `streamId`; `signals` and `relay` use existing `streamId` plus current positive `liveGeneration` (or reviewed manifest generation override) |
| `system` | `health`                                                                                               | Safe timestamp input; supplementary only                                                                                                                                       |

This is **19 source-derived query procedures**: 1 auth, 9 social, 4 live, and 1 system query. The recovery regression asserts the exact count and includes `live.relay`; an added source `.query()` remains inventory drift until it receives a reviewed definition.

Each API request is a finite-timeout `GET /api/trpc/<query>` with `redirect: "error"` and a 64 KiB response limit. A redirect is never followed, so a bearer is never sent to a redirected origin. Network, malformed, truncated, and oversized responses become redacted result categories; response bodies, SQL diagnostics, cookies, DSNs, bearer tokens, config values, and private paths are not printed. `social.feed`, `social.circles`, and `live.list` are the final public data readiness checks.

**Automatic scope is deliberately narrower than HTTP GET.** The utility calls only reviewed, source-derived tRPC `.query()` procedures. It never auto-probes OAuth start/callback/mobile/session-exchange endpoints, logout, storage/media proxy routes, or any route that can set state, issue/clear a session, or depend on an arbitrary object key. It also never calls `live.join`, `live.heartbeat`, `live.leave`, signaling writes, or a social mutation to manufacture a live/viewer context.

## Exit status and limits

- `0`: allowed preflight/restart/verification completed without failures; in strict mode coverage was complete.
- `1`: rejected configuration/target/private input/database/schema, failed restart/readiness/query/shape, or strict incomplete/inventory-drift coverage.
- `2`: invalid/ambiguous CLI arguments.

The focused tests use only synthetic fetch responses, injected restart/database adapters, mocked PostgreSQL modules, a copied bundled script, and temporary local files. They do not access a real database, provider, service manager, browser, auth session, Host deployment, or deployed Preview. Passing tests or this utility does not apply a migration or prove real OAuth, durable-session data, provider connectivity, or actual production service state.

## Staged operations-history fallback migration

`operations/migrations/0003_circles_ops_history_fallback.sql` is a **parent-release-owned staged migration**, not a command for this recovery utility. It replaces only the existing private `circles_ops.run_daily_migration_health()` function. Its nested history-write exception returns the fixed, sanitized `health_history_unavailable` result if the `circles_ops` schema or `health_runs` table is unavailable; it neither recreates those objects nor exposes exception text.

The file has an explicit `BEGIN`/`COMMIT` and transaction-scoped advisory lock. The approved Supabase migration transport must submit the entire file as one transaction-capable batch; do not use `db:push`, rewrite applied `0001`, recreate Cron job 7, or change provider/global grants. Run the static-only staged regression and a disposable local PostgreSQL fixture before a parent-approved migration application. A live production audit or an absent live context is **incomplete evidence**, never a failed synthetic test or a claim that an audit was called.
