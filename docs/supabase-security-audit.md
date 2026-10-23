# Circles application-schema security auditor

`pnpm audit:database` is a **read-only, metadata-only** PostgreSQL 17 security auditor for the 22-table `circles_app` boundary: 21 application tables plus `_dataMigrations`. It is separate from the OAuth pending-state auditor, the daily migration-health job, backups, and runtime recovery.

## Safe invocation

Use the protected runtime configuration already approved for the server. Do not put a database URL, password, token, or certificate value on the command line. Choose an already existing, owner-controlled directory outside **every** Git worktree:

```bash
pnpm audit:database \
  --json-output /private/circles-audits/2026-10-23/database.json \
  --markdown-output /private/circles-audits/2026-10-23/database.md
pnpm test:database-audit
```

Both report paths are required, must be distinct and new, and are validated before database access. Their parent components must not be symbolic links, their parent directory must be owner-controlled with no group/other access, and the created report files use exclusive creation with mode `0600`. The auditor refuses paths below the project Git tree or any other detected Git worktree and refuses existing files; it never overwrites a prior report.

## What it evaluates

- exact **22-table** inventory, ownership, RLS enablement, and server-only policy shapes;
- runtime-role identity/flags and both directions of any membership edge involving the role;
- complete effective privilege matrices for all cataloged non-owner roles, including schema `USAGE`/`CREATE`; table CRUD, `TRUNCATE`, `REFERENCES`, `TRIGGER`, and PostgreSQL 17 `MAINTAIN`; column privileges; sequence `USAGE`/`SELECT`/`UPDATE`; and routine `EXECUTE`;
- direct ACL attribution, including `PUBLIC` and grant-option rows, in addition to effective privileges (so inherited membership effects are not hidden);
- the backend's exact table/marker, sequence, routine, and schema boundaries;
- global default-ACL overrides merged with schema-additive default ACLs. Dangerous future table/sequence/routine grants, including PUBLIC function EXECUTE, remain failures; built-in default TYPE USAGE is separate conditional metadata, not proof of present table or API exposure;
- function `SECURITY DEFINER` search-path indicators and a deliberately conservative PostgREST exposure indicator.

The audit uses catalog queries inside a read-only transaction and bounded `SELECT 1 ... LIMIT 1` permission probes inside rolled-back read-only transactions. It does not issue DDL/DML, read application row values, expose raw driver errors, or print credentials.

## Reading results and limits

The full matrix is retained for all roles. Only exact reviewed PostgreSQL built-ins and Supabase administrative roles are classified separately, with identity checks and privileged membership-path validation. Ordinary/API/runtime roles and lookalikes remain fail-closed; a NOINHERIT/SET ROLE path to an administrative capability is still rejected. `has_*_privilege` metadata alone does not demonstrate RLS row access or Data API exposure.

A `fail` means the evidence was incomplete or an enforced boundary differs from the reviewed design. An `unknown` schema-exposure indicator is **not** evidence that the schema is absent from every API gateway; confirm gateway configuration separately. The report does not test a live user journey, signed-in authorization, revocation, device/provider behavior, or public HTTP API behavior.

The existing **Cron job 7** (`circles-app-daily-migration-health`) is not modified or scheduled by this auditor. Do not rewrite applied migrations or global/default ACL configuration merely to make an audit pass; investigate and apply a reviewed additive remediation separately.
