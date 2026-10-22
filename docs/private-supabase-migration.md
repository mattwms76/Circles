# Private Supabase PostgreSQL migration rollout

## Scope and non-negotiable boundaries

This is a **parent-operated cutover guide** for Circles. It migrates only the app's legacy MySQL/TiDB data into `circles_app` in Supabase project `vvclcsqletcxzoaayqzq`.

- Keep the current Manus OAuth provider, application/signing identity, integer IDs, durable application-session authority, API shapes, media references, and Expo/Preview/native configuration.
- Do **not** touch Supabase `public`, `private`, `auth`, or `storage` schemas, existing policies, or existing data.
- Keep managed `DATABASE_URL` unchanged as the read-only MySQL/TiDB import and pre-cutover rollback source. The API runtime uses only server-side `SUPABASE_DATABASE_URL`.
- Do not paste database URLs, passwords, session fingerprints, rows, message content, or digest inputs into commands, logs, tickets, or evidence.
- This guide does not authorize a deployment, database operation, service restart, or data transfer. Those actions remain parent-controlled.

## What is in the candidate

| Area                     | Contract                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime driver           | The pinned primary driver is `pg` **8.16.3** with `@types/pg` **8.15.5**. No framework, Expo, React Native, Drizzle, or TypeScript upgrade is part of this migration.                                                                                                                                                                |
| Connection               | `server/_core/postgres-config.mjs` accepts only `SUPABASE_DATABASE_URL`, validates the authorized project/database/user, normalizes the known direct URL to the verified IPv4 **session** pooler, and loads the public CA at `server/certificates/supabase-root-2021.crt` with hostname verification and `rejectUnauthorized: true`. |
| API privilege boundary   | `server/runtime-role-pool.ts` initializes `SET ROLE circles_app_runtime` for every checked-out `pg.Pool` client. A failed role initialization destroys the client; `server/db.ts` has no MySQL fallback.                                                                                                                             |
| Private DDL              | `drizzle/postgres/0000_circles_app.sql` creates only `circles_app`, `circles_app_runtime`, its app tables, RLS/policies, grants, and `circles_app."_dataMigrations"`. Historical MySQL migrations under `drizzle/` stay archived provenance and are not PostgreSQL migration history.                                                |
| Runtime marker privilege | The runtime role receives `SELECT` only on `_dataMigrations`. An administrator connection running the finite importer is the only path that writes its completion marker.                                                                                                                                                            |
| Transfer                 | `scripts/migrate-to-supabase.mjs` reads the 21-table allowlist in `scripts/supabase-data-manifest.mjs`, uses a bounded consistent source snapshot and one serializable private-target transaction, preserves explicit IDs, resets identities, and records completion only after count and canonical SHA-256 parity.                  |

The dedicated transfer details are in [supabase-data-transfer.md](./supabase-data-transfer.md). The candidate's offline Drizzle configuration targets only `circles_app`; it has no database credentials.

## Required package commands

The package intentionally exposes finite commands only:

```sh
pnpm db:supabase:preflight
pnpm db:supabase:apply -- --acknowledge-write-pause=I_CONFIRM_CIRCLES_API_WRITES_ARE_PAUSED
pnpm db:supabase:verify
```

`db:supabase:apply` deliberately does **not** embed the acknowledgement. Never turn it into an unattended job or infer a write pause from a successful preflight.

> Do not use the existing generic `db:push` command for this cutover. Parent review and Supabase's reviewed migration-apply path own private-schema DDL; the importer owns data copy only.

## Parent-only rollout sequence

### 1. Freeze the reviewed candidate and inspect before any database change

1. Confirm the target project reference, `postgres` database, verified session-pooler endpoint, and public CA fingerprint against the approved connection research.
2. Confirm that `circles_app` and `circles_app_runtime` do not already exist. A collision requires investigation; do not reuse or overwrite the object.
3. Confirm no candidate diff changes the active app, `public`, `private`, `auth`, or `storage` objects. Verify the private SQL creates no login password or password rotation.
4. Review the source inventory and transfer manifest together. The manifest must still cover the exact 21 legacy app tables, including `applicationSessions`, seed markers, upload ownership, message watermarks, and live metadata/leases/receipts.
5. Before DDL, use a parent-controlled **read-only** source check to identify `lower(handle)` collisions. PostgreSQL's `profiles_handle_ci_unique` index intentionally preserves the legacy case-insensitive handle invariant and will safely reject an unresolved pair. Resolve any collision with an approved, separately documented data decision; do not silently select, delete, or rename a profile during import.

### 2. Apply reviewed private DDL only

Use the parent-approved Supabase migration-apply workflow to apply exactly `drizzle/postgres/0000_circles_app.sql` after the collision checks. Do not run SQL from this guide and do not replay the archived MySQL migration journal.

The parent must then perform real, read-only catalog checks that confirm:

- `circles_app` is the only new schema and contains the 22 runtime/readiness tables, including `_dataMigrations`;
- `circles_app_runtime` is `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS`, and not superuser;
- `PUBLIC`, `anon`, `authenticated`, and `service_role` have no private-schema/table/sequence access;
- RLS is enabled on every Circles table, runtime DML policy applies to the API tables, and `_dataMigrations` is runtime `SELECT` only;
- every legacy numeric `id` destination uses an identity/serial backing sequence; and
- the API pooler principal can set only the restricted runtime role before API queries.

Record pass/fail facts only—never connection strings, query output containing data, or user/session values.

### 3. Preflight before the write pause

With the protected environment supplied only to the parent process, run:

```sh
pnpm db:supabase:preflight
```

It must confirm the source allowlist shape, private target shape, source snapshot strategy, and that the target is either empty or a matching verified completed migration. A mismatch, nonempty target, marker mismatch, unavailable source, or connection/certificate failure is a stop condition.

### 4. Controlled atomic transfer

1. Stop the identified active API writer and independently confirm it cannot accept writes. Keep Metro on port **8081** untouched.
2. Run the explicit acknowledged command shown above. The importer uses a TiDB-compatible repeatable-read snapshot when the verified source identifies as TiDB, writes no source rows, takes target advisory/table locks with timeouts, and runs all target copy/parity/marker work in one serializable transaction.
3. Do not rerun after a failed command. Investigate the reported safety code first. The importer does not truncate, overwrite, seed, or repair a target.
4. Run `pnpm db:supabase:verify`. It requires a completed marker and checks both target data and a fresh current source snapshot against the recorded per-table parity summary.

A completed rerun is safe only when target marker/data parity and current source parity both match. It must fail if the source changed.

### 5. Cut over the runtime only after data parity

1. Run the real parent-owned catalog/role-denial checks from step 2 and confirm unauthenticated Supabase Data API roles cannot access `circles_app`.
2. Supply `SUPABASE_DATABASE_URL` only to the identified API process. Do **not** pass `DATABASE_URL` to runtime. Preserve the existing OAuth, session signing, and identity environment values without rotation.
3. Run the guarded PostgreSQL readiness/recovery workflow using the existing `pnpm recover:api` command and parent-selected trusted environment source. It must verify catalog/role/RLS/privileges rather than merely opening a socket.
4. Restart **only** the API on port **3000** after readiness is green. Do not restart or reconfigure Metro port **8081** as part of the data cutover.
5. Perform parent-owned read-only API smoke checks, authenticated session/revocation checks with approved fixtures, private-circle/DM authorization checks, and controlled live host/viewer validation. Do not fabricate accounts, rows, broadcasts, media, or native-device evidence.

## Rollback and incident rules

- **Before any new PostgreSQL runtime write:** stop the PostgreSQL API path and return to the unchanged MySQL source only after confirming the old API configuration and durable-session authority remain intact.
- **After PostgreSQL accepts new writes:** do not drop `circles_app`, rerun import destructively, or claim MySQL is current. Rollback requires a reconciled migration plan for the new PostgreSQL writes.
- A failed preflight, parity check, role initialization, certificate check, marker verification, or authorization check is fail-closed. Preserve the original MySQL source and investigate without data-changing repair commands.

## Evidence expectations

The final parent evidence should state the reviewed candidate commit, offline check results, DDL apply acknowledgement, preflight/apply/verify outcomes, catalog/role-denial outcomes, API-only restart outcome, and explicitly remaining authenticated/native/live gaps. It must not include secrets, private rows, messages, IDs tied to people, bearer tokens, session fingerprints, or raw SQL result data.
