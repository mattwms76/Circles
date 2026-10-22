# Circles — approved private Supabase migration

## Approved scope

The user selected: “Keep the current login and migrate the app’s data into a separate private PostgreSQL schema in Supabase.” Target Circles (`vvclcsqletcxzoaayqzq`), schema `circles_app`. Preserve Manus OAuth, numeric user/resource IDs, durable sessions and revocation, signing/app identity, encrypted object storage, API contracts, native identifiers, navigation and hidden scrollbars. Preserve all existing Supabase public/private/auth/storage schemas, tables, policies and records. Preserve the original managed MySQL database as a pre-cutover rollback source; do not overwrite platform DATABASE_URL.

## Implementation approach

Convert the app’s Drizzle table definitions and database-specific service operations to PostgreSQL while retaining the same table/column names inside `circles_app`. Use a PostgreSQL connection pool fed by server-only SUPABASE_DATABASE_URL; normalize this verified project’s supplied direct URI to the exact Dashboard IPv4 session-pooler endpoint in memory. Load the official public Supabase CA and enforce certificate/hostname verification. Require valid target identity and fail closed on missing/invalid configuration or session-store failure.

Separate schema administration/data transfer from runtime access. A deterministic PostgreSQL migration creates only `circles_app` and an application-only NOLOGIN/NOBYPASSRLS role. The API must acquire a role-restricted connection before any query; a failed role initialization must never return an unrestricted client. Deny PUBLIC/anon/authenticated/service_role schema access, enable RLS on app tables, and grant only the application role the table/sequence privileges and server-side policies needed for the existing resource-authorized API. Do not expose `circles_app` through the Supabase Data API.

Keep historical MySQL migrations for provenance and use a distinct PostgreSQL migration directory/journal. Implement a finite, guarded importer using explicit table/column metadata, a consistent read-only MySQL snapshot and bounded batches. Stop the identified API for the final transfer to prevent concurrent writes. Preserve IDs, timestamps, memberships, message watermarks, upload references, all live generations/leases and every durable session row. Copy only into the intended new schema, require an empty target or an exact completed-import marker, reset identity sequences, and record completion only after row counts and canonical content digests match. Do not emit rows, credentials or message content into artifacts/logs.

Serve the converted API on port 3000 after schema/data parity, with Metro remaining on 8081. Keep the fixed Expo React Native starter and Manus-managed canonical repository; mirror tested source to the already authorized mattwms76/Circles GitHub copy. Publication and signed store builds remain separate from Preview cutover. A pre-cutover rollback may return to unchanged MySQL; after new PostgreSQL writes, reverting to the old data requires reconciliation rather than silently discarding new records.

## Project structure

`drizzle/schema.ts`, `drizzle/live-schema.ts` and `drizzle/session-schema.ts` hold the private PostgreSQL tables. `drizzle/postgres/` holds the new deterministic migration/journal. Existing historical MySQL SQL/snapshots remain archival source, not runnable PostgreSQL migrations. `server/db.ts` and a server-only connection helper own pooled, role-restricted database access. `server/social-service.ts` and `server/live-router.ts` retain the social/live authorization and transaction semantics using PostgreSQL returning/conflict operations. A migration manifest and finite script under `scripts/` own safe source-to-target copying. Recovery/environment support scripts, CI and docs identify the actual PostgreSQL provider. Tests use synthetic configuration and controlled non-production databases; no production user/session is fabricated.

## Design and interaction continuity

Reuse the approved warm editorial Circles design and existing React Native navigation. This is a backend migration, not a redesign. Preserve screen layouts, identity, media URLs, current OAuth callbacks, local/native credential handling, error/retry states and one-handed interaction. No decorative assets or new fonts are needed.

## Production operations extension — 22 October 2026

Keep app data and authorization unchanged. Implement a reusable, read-only catalog/permission audit for `circles_app`; retain evidence and a report outside the public repository. Add a distinct private `circles_ops` namespace containing sanitized operational health history and an admin-only, fixed-search-path function. Use existing Supabase `pg_cron` for a daily 03:15 UTC migration/schema/RLS health job; never automatically migrate, repair, restore or modify app rows. Version the reviewed SQL and operator instructions in source, but apply DDL through Supabase migration management and verify the actual deployed job separately. The operations check is not a backup or an external outage alert.

The current Supabase Free project has no included automatic provider backups. Backup setup remains pending the user's authorized choice between a separately approved paid provider option and encrypted exports to a selected off-site destination. Do not upload production exports elsewhere or copy database credentials into a new service before that choice. Real native/live E2E requires accessible iOS/Android development/release builds, test accounts and approved host/viewer fixtures; available browser/API observations remain clearly labeled partial, with no fictitious sessions or native compatibility claims.
