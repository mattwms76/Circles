# Post-push blocker recovery — 29 October 2026

## Scope

Use existing stored values for the live PostgreSQL diagnostic; resolve the watchdog CI test's hard-coded evidence path; deliver a text-only presentation script based on the prior post-push verification report. Preserve concurrent source work, prepared migration gates, native identity, private database roles/TLS, signing/media keys, and production records. No publication or provider password reset is requested.

## Stored PostgreSQL value

A trusted runtime refresh was applied and the stored `SUPABASE_DATABASE_URL` was tested using the app's existing exact-target, certificate-verified TLS connection helper. The configuration passes target validation, but a fresh bounded connection is still rejected with SQLSTATE `28P01`. API `/api/health` remains 200, `/api/ready` remains 503, and Metro's status listener remains available.

Reusing a rejected password cannot restore database authentication. The stored Supabase Auth URL and publishable key are HTTP authentication configuration, not a PostgreSQL database password, and must not be substituted into the database DSN. No credentials were printed, reset, guessed, or rotated, and a failed preflight did not trigger a service restart.

**Still required:** the owner must supply a current valid database connection string through protected input, or separately authorize a database-owner password reset if that password is unavailable. Do not paste a connection string or password in chat. Keep the current database and login identity, percent-encode special password characters in the URL, and do not activate the staged bootstrap/login-role cutover as a workaround. Existing stored values were reused as requested; none was changed by this work.

After a valid value is saved, refresh trusted runtime once and require a successful read-only connection and restricted-role readiness check before restarting only the identified API process through its existing ownership mechanism. Preserve healthy Metro and repeat private-schema readiness plus same-origin `social.profilesPage` reads without creating production fixture data. Newly prepared schema/role/provider prerequisites remain separate approval gates; password recovery does not authorize their activation.

## Watchdog CI portability

The inherited crash-recovery test wrote JSON evidence under `/home/ubuntu`, a machine-specific directory that GitHub runners cannot create. The narrow correction places evidence under that test's existing `mkdtemp` directory instead. Preserve private directory/file permissions, different initial/replacement PID assertions, replacement generation, restored health, and cleanup of the owned temporary directory. This changes only the test's evidence destination, not production supervision behavior.

Local corrected-test results and hosted CI are recorded separately in the task evidence and final handoff. A local pass is not a hosted CI pass, and container-build success does not certify live database authentication.

## Verification boundaries

The historical report tested `c7ad369`, with 1,163 passing local tests, 26 focused People tests, six isolated HTTP/PostgreSQL cases, and 24 retained design repairs with 86 dedicated cases. These counts overlap and are not additive. This recovery started after canonical main had advanced to `0b8f05d06d86e574b0020334bb2ed80f6528f8f2`; historical totals must not be labeled as new tests of that later source.

Physical Android/iOS, keyboard/IME, enlarged native font, safe-area, screen-reader, provider and production-scale performance verification remain separate evidence. Live ranking can change between cursor requests; refresh after follow/interest changes rather than promising a frozen snapshot.

## Executed narrow repair evidence

The corrected canonical source passed 1,188 tests across 241 files, TypeScript with strict unused checks, zero-warning lint, full source formatting and the API build. All 13 current-canonical watchdog tests also passed as the unprivileged `nobody` user with no write access to `/home/ubuntu`; private proof mounts/directories were removed. Applying the same test-only delta to GitHub's separate `c7ad369` source passed all 14 of that revision's watchdog cases, typechecking, focused lint and formatting. The differing test totals belong to different preserved source histories.

The test-only GitHub change was pushed normally to main as `06bbc710b78ec6c2a43233086275188210d689aa`. Hosted CI is checked separately; this source record does not predeclare its outcome. Canonical audit changes and GitHub helper-consolidation work were preserved independently, with no force push or unrelated merge. The stored database setting remains rejected and live recovery remains open.
