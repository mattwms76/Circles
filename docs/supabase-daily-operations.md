# Supabase daily operations and production verification

Target: **Circles**, project `vvclcsqletcxzoaayqzq`, PostgreSQL17, application data in `circles_app`. The current login and server-side authorization are unchanged. This setup does not publish an app-store build or demonstrate native compatibility.

## Implemented daily migration/schema health check

The Supabase migration `circles_ops_daily_migration_health` creates the independent private `circles_ops` schema, `health_runs`, and `run_daily_migration_health()`. The reviewed SQL is versioned under `operations/migrations/0001_circles_ops_daily_migration_health.sql`; it was applied through Supabase's migration transport on22 October2026, not through the app's Drizzle journal. **Do not reapply it blindly with db:push.**

Verified native PostgreSQL Cron job:

| Setting  | Verified value                                     |
| -------- | -------------------------------------------------- |
| Name     | `circles-app-daily-migration-health`               |
| Job ID   | 7                                                  |
| Schedule | `15 3 * * *`                                       |
| Timezone | GMT/UTC; daily03:15UTC                             |
| Owner    | `postgres`                                         |
| Command  | `SELECT circles_ops.run_daily_migration_health();` |
| Active   | true                                               |

The first actual manual run at `2026-10-22T17:51:35.062106Z` returned `healthy=true`, with no error code. Every stored invariant was true. The latest observed scheduled run at `2026-10-23T03:15:00.104436Z` also returned `healthy=true` with no error code. The existing job remains unchanged; these observed results do not guarantee future success.

Checks cover the exact22 current app tables and ordered columns,17 identity sequences, enabled RLS, expected server-only policies, role/grant isolation, immutable import-marker match, durable-session indexes, and the private operations boundary. They do not compare historical row counts, automatically repair drift, rerun data import, validate every column type/foreign key, or establish native/live behavior. An intentionally approved future schema change must update this guard in a reviewed additive migration.

The security-definer function is admin-only, takes no arguments, has `search_path=pg_catalog`, and contains no dynamic SQL or external calls. Supabase API roles and `circles_app_runtime` have no operations-schema usage, history read privilege, or function execution privilege. Run history contains booleans/aggregate counts and fixed sanitized codes only. It retains90days of operational history; only expired operations-history rows are deleted, never app rows.

Inspect health separately from Cron transport status:

```sql
SELECT run_id, ran_at, healthy, error_code, checks
FROM circles_ops.health_runs
ORDER BY run_id DESC
LIMIT 5;

SELECT jobid, jobname, schedule, username, active
FROM cron.job
WHERE jobname = 'circles-app-daily-migration-health'
LIMIT 1;
```

**A Cron success does not mean healthy=true.** Review the recorded health result. No external notification/alert channel has been configured. The in-database job cannot execute while the project/database is down or paused and is not independent outage detection.

To pause only this named job as its owner:

```sql
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'circles-app-daily-migration-health'
  AND database = current_database()
LIMIT 1;
```

Do not drop application or operations schemas to pause monitoring. Verify the named job's actual current state before any scheduling change.

## Repeatable read-only schema security report

Inject the protected server-side Supabase configuration through the approved runtime, not command-line password strings. From the project root:

```bash
pnpm audit:database --json-output /private/report/location/audit.json \
  --markdown-output /private/report/location/audit.md
pnpm test:database-audit
python3 operations/migrations/check_health_migration_static.py
```

The report checker resolves the existing PostgreSQL connection helper, verifies certificates, reads bounded catalog metadata, and runs rollback-safe SELECT1 permission probes. It never exports app rows or raw driver errors. Reports should be saved to an existing approved private directory outside the public repository. Missing/unsupported gateway-exposure metadata remains UNKNOWN, not a fabricated pass.

The live audit found RLS enabled on all22app tables, expected backend-only policies, a hardened non-login runtime role, marker read-only runtime access, and denial to `anon`, `authenticated` and `service_role`. `USING true` policies are intentionally server-only gates: **per-user/per-circle authorization must remain in the API**. The privileged connection principal is still a trust boundary; rotate any credential disclosed outside protected input using a coordinated secret update, not an unannounced password reset.

The authorized Data API Dashboard separately showed `public` and `graphql_public` selected and `circles_app` unselected. The project-wide auto-expose-new-tables option is enabled; review its impact before changing this global setting, and retain explicit RLS/revocations in every app/operations migration. A fresh Supabase Advisor check after installation returned no ERROR/WARN, and nine pre-existing INFO RLS-without-policy entries in other schemas; no unrelated policies were changed. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Verified test coverage and remaining gaps

Production-database-backed guest web E2E has11effective passing checks,0failures, and5explicitly skipped protected/native/live areas. The original iframe timing failure remains in private evidence; its scoped recheck waits for an actual API response rather than only850ms of static rendering and passed. No production app mutation was performed by those guest checks. The full existing unit suite has161passing tests, the auditor has8passing synthetic tests, TypeScript passes, and source ESLint has zero errors/warnings. These are not native-device test results.

Real iOS/Android authentication/deep-link/SecureStore/logout replay, private multi-account messaging/moderation/attachments, and two-party camera/audio/video/reconnect tests need approved accounts, fixtures, and authorized devices or simulators with custom development/release builds. Native WebRTC cannot be certified through Expo Go or a portrait browser.

## Verified encrypted private Release backups

The project remains on Supabase Free, without included native daily backups. The owner approved encrypted exports to the separate private repository [mattwms76/Circles-backups](https://github.com/mattwms76/Circles-backups), then explicitly approved private Release assets with 30-day cleanup after Actions artifact storage was quota-blocked. The daily schedule remains 03:35 UTC plus manual invocation. Strict TLS, consistent read-only production export and isolated PostgreSQL 17 app/operations restore remain unchanged. The database URL is an Actions secret scoped to export. Storage steps use the standard repository-scoped token with contents: write; the private recovery identity and disclosed temporary PAT are not in GitHub.

[Run 39921304048](https://github.com/mattwms76/Circles-backups/actions/runs/39921304048) succeeded, including read-only export, isolated 23-table restore, encryption, private Release upload and cleanup. [The first backup release](https://github.com/mattwms76/Circles-backups/releases/tag/circles-backup-39921304048-1) was published at 2026-10-23 07:59:36 UTC with exactly three assets: a 1,895,048-byte age ciphertext and two checksum/size/time metadata files. Server and downloaded SHA256 values, private-key decryption, tar inventory and inner dump/role checksums passed; temporary downloads/plaintext were removed. All 29 safety tests, Python syntax, actionlint and diff checks passed. No production restore or unrelated storage deletion occurred, and no paid setting was enabled.

Cleanup deletes only canonically marked, run-specific releases produced by this workflow after at least 30 days since their latest publication, release edit or asset creation/update. It requires bot authorship, exact repository/workflow/run metadata, canonical name/body, allowed assets and mandatory matching server digests, enumerates all pages before deletion, and re-reads candidates. Source-code tags and unrelated releases/artifacts are untouched. First cleanup succeeded with zero expired releases removed, preserving the first backup until at least 22 November 2026 at 07:59:36 UTC. Synthetic tests prove the time boundary; no expired production fixture was fabricated. Cleanup is also attempted after passed privacy/safety checks if a later backup stage fails.

Thirty days is a workflow cleanup policy, not native guaranteed expiry; failed/disabled/delayed runs can retain releases longer. GitHub quotas and availability can still block future backups. No guaranteed RPO/RTO is established. Health history is not a backup. The app/operations drill does not certify full managed Supabase recovery. Storage API object bytes, custom-role passwords and application/provider signing or encryption secrets require separate continuity arrangements. Securely save the separately delivered private recovery key, revoke the temporary PAT disclosed in chat, and never use the live project as a restore-test target.

Sources: [Supabase backups](https://supabase.com/docs/guides/platform/backups), [Supabase Cron](https://supabase.com/docs/guides/cron), [Circles Cron management](https://supabase.com/dashboard/project/vvclcsqletcxzoaayqzq/integrations/cron/jobs).

## Outstanding-fix deployment — 23 October 2026

The additive migration `circles_auth_durable_oauth_pending_state` installs a separate private `circles_auth.oauth_pending_states` helper; it does not change the22application tables, other schemas or Cron7. OAuth state/cookie/handoff fingerprints are durable across API instances, expire and are atomically consumed once. A disposable PostgreSQL17 drill passed binding, expiry, replay and two-connection consumption checks; the fixture was removed. Production metadata confirms forced RLS, runtime SELECT/INSERT/DELETE but no UPDATE, and no schema/table access for anon/authenticated/service_role. No production OAuth-state records were inserted as test fixtures.

The API has separate `/api/health` liveness and `/api/ready` private-data readiness. Readiness checks the restricted runtime role, all22 readable RLS-enabled tables and the helper's exact policy/privileges. Runtime catalog probes passed without user-row access. The prepared nonroot, digest-pinned Node22.23.4 API container uses `/api/ready`; this declaration is not publication. Native EAS profiles and guarded authenticated/native/release tooling are implemented, but device/signing/provider evidence remains open.

The private repository now also runs `operations-watchdog.yml` daily at05:05UTC/manual, independent of the unchanged03:15health and03:35backup schedules. It reads one sanitized health aggregate and canonical scheduled-run/release metadata, then deduplicates alerts to one marker-bound bot-owned owner-assigned issue and closes that issue after recovery. First execution detected a pre-activation schedule as missing; the confirmed boundary error was fixed using actual workflow creation time. Corrected run [39930795401](https://github.com/mattwms76/Circles-backups/actions/runs/39930795401) passed with incident=false, database_available=true and no conditions; its previously raised private issue1 was closed by the watchdog. All47 backup/watchdog safeguards pass. GitHub notification delivery depends on owner settings; no receipt is fabricated and the monitor cannot independently detect a GitHub-wide outage that stops it.

The first automatic backup slot after workflow activation is24October2026 at03:35UTC; real30-day cleanup remains future-dependent. The existing manual ciphertext/download/decryption evidence stands. The full archive includes the newly installed private helper on subsequent exports, but the fixed23-table app/operations restore drill does not certify helper recovery; recreate it empty from the migration rather than replaying pending OAuth state.

Production live now requires validated server-only TURN settings, issues authenticated short-lived relay credentials and refreshes web/native peers without changing signaling generations. Missing/unsafe production relay configuration disables live rather than unrelated API features. Its real network/device proof and deployed-provider configuration remain prerequisites. A live-enabled store release also requires explicit relay setup and real relay verification attestations; synthetic proofs cannot close the gate.

Recovery continuity tooling supports bounded, private read-only app-owned media-reference inventories and separately age-encrypted exports through the authenticated app media proxy. Actual media/key continuity and isolated recovery proof need the approved account/media/signing inputs; provider-managed objects and opaque keys are not silently exported. The exposed database credential/PAT remain owner-assisted security actions while GitHub secret-write access and authenticated provider/token settings are unavailable. Do not reset the database credential until both consumers can receive it safely.

Final implementation verification:207tests across35files passed with credentials removed under SHA256-verified Node22.23.4; prior full TypeScript/zero-warning lint/environment/API checks and all3JS exports pass. The restarted API reports database=true/oauthState=true/liveRelay=false and Metro remains available. The normal canonical/source-copy pushes accepted the code. Manual container run[39933720513](https://github.com/mattwms76/Circles/actions/runs/39933720513) passed the locked image build, nonroot pinned-CA read, liveness and intentional503missing-datastore readiness checks with no production credential. No signed build/publication/real-account/live/device proof or credential/PAT rotation is claimed. Remaining access-dependent outcomes stay open in TODO.md.

## Current integration follow-up — 23 October 2026

Private integrity/health-history/trigger least-privilege migrations were locally rehearsed and applied without app-row rewrites or Cron 7 changes. The latest post-migration health result was healthy. Current immutable backup 39958413478 passed read-only export, isolated 23-table restore and private Release delivery; actual downloaded asset digests, owner-key decryption and inner package checksums passed. Final real app CI 39959877430 and container 39959877597 passed without production/provider credentials or app publication. See [remaining-fixes-20261023.md](remaining-fixes-20261023.md) for exact boundaries and the still-open credential, relay/native, recovery-key and four-advisory requirements.
