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

The first actual manual run at `2026-10-22T17:51:35.062106Z` returned `healthy=true`, with no error code. Every stored invariant was true. Future scheduled execution has not yet occurred; an enabled job is not evidence of a future successful run.

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

## Backup activation remains pending

The verified organization is Supabase Free; its Dashboard confirms included automatic daily backups are unavailable. The user must approve either an eligible native-provider backup route or encrypted off-site exports with an approved private destination and encryption/access configuration. **No backup schedule, backup file, restore, paid upgrade or established RPO/RTO has been created or claimed.**

Health history is not a backup. Database backups do not include Storage API object bytes or custom-role passwords, and existing managed app media needs a separate continuity policy. A real backup plan must include retention, access control, observed first backup, and an isolated non-production restore drill. Never use the live project for a restore test.

Sources: [Supabase backups](https://supabase.com/docs/guides/platform/backups), [Supabase Cron](https://supabase.com/docs/guides/cron), [Circles Cron management](https://supabase.com/dashboard/project/vvclcsqletcxzoaayqzq/integrations/cron/jobs).
