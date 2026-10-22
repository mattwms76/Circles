# Circles private Supabase cutover — 22 October 2026

Circles now uses PostgreSQL in Supabase project **Circles (`vvclcsqletcxzoaayqzq`)**, database `postgres`, private schema `circles_app`. The API on port 3000 was switched to the reviewed PostgreSQL implementation after a controlled writer pause, atomic import and independent parity verification. Metro remained running on 8081.

## Preserved data and login

The import copied **24 existing application records across 21 allowlisted app tables**. Every table's row count and canonical SHA-256 digest matched before the completion marker was committed, and a separate fresh source/target verification passed again after cutover. Numeric IDs, timestamps, membership state, stored media references, seed markers, session-table structure, message watermarks and live generation/lease structures were retained. Empty tables were verified as empty; no test accounts, messages, sessions or broadcasts were fabricated.

The source held five users, five profiles, five circles, five memberships, three posts and one starter-content completion marker. Other application tables were empty. No active session row or active stream existed to exercise genuine signed-in/revocation or two-party video behavior.

Current Manus OAuth remains the login provider. The app identity and signing-key continuity checks passed against the old API's runtime before stopping it. Existing Supabase UUID/auth.users-based tables were not substituted for the app's integer-ID/Manus-login model. Original MySQL/TiDB data and its five-row historical migration journal remain unchanged for provenance and controlled pre-write rollback; that journal was not replayed into PostgreSQL.

## Security and connection verification

Only the new `circles_app` schema, application role and its app objects were created. Supabase's existing public/private/auth/storage schemas and records were not changed. The 22 private tables include the 21 app tables plus an administrator-written import marker.

All 22 tables have RLS enabled. `circles_app_runtime` is non-login, non-inheriting, non-superuser and cannot bypass RLS. Its normal app table privileges are restricted to the new schema; it can only read, not change, the import marker. Actual SELECT-only role tests denied private user-table access for `anon`, `authenticated` and `service_role` with PostgreSQL insufficient-privilege responses. The backend role could read that table. Real Drizzle query and transaction checks both ran as `circles_app_runtime`, not the privileged connection principal. Application resource authorization remains server-side.

TLS uses the verified Supabase CA and hostname checking through the project's session pooler. The running API contains `SUPABASE_DATABASE_URL` but no legacy `DATABASE_URL`; dotenv is prevented from reloading the old local credential. No credential is committed or exported into this report. The current security advisor returned no warning/error findings; nine pre-existing informational no-policy findings remain in other schemas. This work does not alter the separate Circlea project named in the earlier alert.

## Validation and the corrected transfer failure

The first apply attempt failed safely and rolled back all copied rows without writing a completion marker. A read-only diagnostic isolated PostgreSQL SQLSTATE `42P18` in the sequence metadata lookup. Explicit text parameter casts fixed it. The corrected real lookup passed, empty-target preflight passed again, and the subsequent import and independent parity checks succeeded. A regression now covers the typed lookup and sequence reset.

The applied source passed TypeScript, **161 tests in 27 files**, zero-warning ESLint and API compilation. One array-style warning introduced in that regression was corrected without disabling rules. Real API/public Preview health passed. Nine public query positives passed across the source-derived inventory and existing circle/profile/member/comment details; protected anonymous-access denial checks also passed. Earlier probes using nonexistent `social.people`/`social.search` names were discarded as probe errors, not application regressions.

The PostgreSQL API log showed no database-unavailable, failed-query, connection-refused or sequence-lookup error category after cutover. Signed-out session warnings are expected negative-path behavior.

Authenticated account actions, actual logout/revocation over the new database, private-resource access with approved users, physical-device SecureStore/deep-link/camera/microphone and controlled two-party live validation remain unverified. Public reads and synthetic tests do not establish those outcomes. This is a Preview/API datastore cutover, not a published production-backend or signed store-build claim.

## Source and operational follow-up

The PostgreSQL schema/driver/services, finite importer, environment/recovery tooling and versioned recovery skill are included in the source change. GitHub CI uses no production credentials and performs tests plus web/iOS/Android JavaScript bundle builds; its actual new run result is tracked separately after the push.

Do not rerun generic `db:push`, archived MySQL migrations, seeding or a destructive import. After PostgreSQL accepts new writes, the old database is stale: switching back requires reconciliation. Use the [private migration guide](private-supabase-migration.md) and [finite transfer guide](supabase-data-transfer.md) for the explicit reviewed modes.

The database password was supplied in chat. Rotate it through Supabase's protected controls and update the server-only secret through secure input when ready; do not rotate the unrelated signing/media key as a shortcut.
