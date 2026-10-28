# Circles database security auditor

`pnpm audit:database` is a **read-only, metadata-only** PostgreSQL 17 auditor for the private Circles authorization boundary. Its source-owned contract covers the current `circles_app` inventory of **26 application tables plus `_dataMigrations` (27 tables total)** and the separately reviewed `circles_admin` control surface of eight RLS-enabled, force-RLS tables.

The source-derived 27-table `circles_app` boundary spans `drizzle/schema.ts`, `drizzle/live-schema.ts`, `drizzle/session-schema.ts`, `drizzle/activity-schema.ts`, and `drizzle/moderation-schema.ts`. The separately reviewed current app/admin contract below remains exact; these five modules do not replace its critical feature, policy, helper, or role checks.

It is separate from the OAuth pending-state auditor, daily migration-health job, backups, provider gateway configuration, runtime recovery, and end-user authorization testing.

## Safe invocation

Use the protected runtime configuration already approved for the server. Do not put a database URL, password, token, or certificate value on the command line. Choose an already existing, owner-controlled directory outside **every** Git worktree:

```bash
pnpm audit:database \
  --json-output /private/circles-audits/2026-10-27/database.json \
  --markdown-output /private/circles-audits/2026-10-27/database.md
pnpm test:database-audit
```

Both report paths are required, distinct, and new. The auditor validates them before database access: parent components cannot be symbolic links, the destination directory must be owner-controlled with no group/other access, and output files are created exclusively with mode `0600`. It refuses project-tree, any detected Git-worktree, or existing-file destinations.

## What DB-05 evaluates

The auditor runs catalog queries in a read-only transaction and bounded `SELECT 1 ... LIMIT 1` role probes in rolled-back read-only transactions. It does not issue DDL/DML, read application rows, expose raw driver errors, or print credentials.

- The exact 27-table `circles_app` inventory, ownership, RLS enablement, and backend table/sequence/schema/routine boundary.
- The exact finite policy contract across `circles_app` and `circles_admin`: app-runtime policies, restrictive `anon`/`authenticated` deny policies, admin-runtime policies, native-executor policies, policy permissiveness, and normalized `USING`/`WITH CHECK` expressions.
- The three named, whole policy states only: the reviewed pre-DB-09 state, DB-09 with the named `parity` policies retained, or DB-09 with the named legacy policies retained. It does **not** accept renamed policies, partially consolidated pairs, or an arbitrary policy subset.
- Exact flags and every membership edge involving `circles_app_runtime`, `circles_admin_runtime`, and `circles_admin_native_executor`. The app runtime and native executor are non-login, non-inheriting, non-superuser, and `NOBYPASSRLS`; the reviewed admin runtime is a non-inheriting, non-superuser, `NOBYPASSRLS` login role.
- The dedicated DB-02 application-login transition as exactly one whole named state: the historical `baseline_pre_db02` state, `no_login_provisioned`, or `login_cutover`. In either provisioned state, `circles_app_login` is `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`, and `NOREPLICATION`; only `LOGIN` changes at protected cutover. Its sole membership must be `circles_app_runtime` granted by `postgres` with `INHERIT FALSE`, `SET TRUE`, and `ADMIN FALSE`. It may have no direct `circles_app` schema, table, column, sequence, or routine ACL. Generic `PUBLIC` catalog baselines are recorded separately and are never attributed as a direct grant to this role.
- Exact direct `circles_app` schema, table, column, and sequence ACLs for the two reviewed admin roles. Any unexpected ACL, grant option, native capability, or role-membership path fails.
- The eight-table `circles_admin` inventory and the complete expected native-helper identity set: signatures, owners, `SECURITY DEFINER` state, search-path indicators, and denial of `anon`, `authenticated`, and `circles_app_runtime` function execution. The only DB-08 transition accepted is the exact named before/after search-path state for `reject_audit_mutation()` and `touch_updated_at()`.
- Effective privilege matrices and direct ACL attribution for every remaining non-owner role. Provider-managed capability roles remain classified by exact identity; all ordinary, browser/API, runtime, lookalike, unexpected grant, and elevation paths fail closed.
- Read-only browser/API-role probes on both `circles_app.users` and `circles_admin.audit`. `anon`, `authenticated`, and `service_role` must be denied.
- Global default-ACL hazards, including future function `EXECUTE`, and private-schema function search-path indicators. A missing or unsupported PostgREST setting remains **unknown**, not proof of gateway non-exposure.

`USING true` policies for server-side roles are a trusted-server boundary, not per-user or per-Circle RLS. This audit does not claim account-scoped database enforcement, public gateway safety, provider configuration success, native behavior, backup/recovery success, or a successful user journey.

## DB-02, DB-08, DB-09, and DB-14 integration notes

- **DB-02:** the dedicated application login remains a protected deployment/cutover concern. The audit accepts only the historical baseline or the two complete named `NOLOGIN`/`LOGIN` states above; it rejects an extra edge, `ADMIN OPTION`, inherited authority, direct object authority, or a changed flag. Credential provisioning and live cutover are not performed by this auditor.
- **DB-08:** the auditor recognizes only the named pre/post invoker-helper search-path states. Parent integration must use the exact DB-08 migration and confirm the resulting catalog state.
- **DB-09:** parent integration must select the actual reviewed duplicate-policy survivor variant. The auditor deliberately accepts no mixed, partial, or inferred consolidation state.
- **DB-14:** any app inventory or readiness-contract expansion requires a reviewed source-contract update before it becomes an accepted audit state. This auditor does not turn a source change into a live readiness claim.

## Reading results and limits

A `fail` means collected metadata was incomplete or differed from an explicitly reviewed state. An `unknown` schema-exposure indicator means provider/API gateway configuration still needs separate authorized verification. `unknown` is deliberately non-passing: the audit reports overall `UNKNOWN` and exits nonzero rather than silently issuing an overall pass. A passing catalog check does not prove browser, provider, native, per-user RLS, recovery, or operational rollout success.

The existing **Cron job 7** (`circles-app-daily-migration-health`) is not modified or scheduled by this auditor. Do not rewrite applied migrations, global/default ACLs, or provider settings merely to make a report pass; investigate and apply a reviewed, authorized remediation separately.
