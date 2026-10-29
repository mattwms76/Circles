# CBA-10 — closed policy health inventories

## Source change

`operations/migrations/0023_circles_ops_policy_health.sql` is an additive, guarded forward migration. It repairs the stale `circles_ops.run_daily_migration_health()` policy predicate that incorrectly required exactly one `circles_app_runtime` policy per application table.

The replacement accepts **only** one of these complete reviewed `circles_app` catalog states across the existing 27 health-covered tables:

| Accepted state                     | Exact policy records | Purpose                                                                                |
| ---------------------------------- | -------------------: | -------------------------------------------------------------------------------------- |
| `current_pre_db09`                 |                   96 | Reviewed current multi-policy catalog before the DB-09 duplicate-policy consolidation. |
| `post_db09_12_group_consolidation` |                   86 | Reviewed DB-09-consolidated catalog using the ten retained survivor names.             |

The comparison is closed in both directions: policy table, name, sorted role set, command, permissiveness, normalized `USING` expression, and normalized `WITH CHECK` expression must match exactly. It is not a policy count threshold, role wildcard, name pattern, or subset check. Extra, altered, or removed policy records leave `backend_policies_restricted=false` and therefore leave the daily result unhealthy.

The surrounding daily checks are retained: app shape/RLS, runtime role, schema/table/sequence ACLs, identity sequences, import marker, session indexes, operations boundary, retention, fixed error codes, return shape, owner, `SECURITY DEFINER`, `search_path=pg_catalog`, and postgres-only execute ACL.

## Intentional compatibility boundary

The migration changes only the one stale policy predicate in the exact reviewed source daily-health wrapper (`definition md5 a4421c8c4e64f1700f2a2771624ecfa0`, body md5 `e508c15fe21081e43c41810df71b5677`). It takes a transaction-scoped advisory lock and uses 2-second lock / 15-second statement bounds.

The exact reviewed current receipt-compatible daily wrapper (`definition md5 02c6415bd9f2715b4bae502b1ed934bb`, body md5 `c9042815f6e02dcfbfe958a30eb7afae`) is recognized as an already-conforming no-op state. CBA-10 does not copy, replace, weaken, or activate that receipt-wrapper logic. The exact reviewed post-policy wrapper that precedes that separate receipt compatibility operation (`definition md5 8a2551dee9f2ea3216d61f82fef70fa1`, body md5 `57fab8e62c7c01e34d393b78b972bd11`) is also a no-op for this policy-only repair; that recognition does not claim receipt-wrapper activation. Any other function body, overload, owner, ACL, security-definer, or search-path state is a refusal condition requiring review rather than a replacement path.

The migration does **not** create or alter policies, roles, grants, schemas, tables, application rows, health history behavior, receipt schema, Cron jobs, or scheduler configuration. In particular, it does not recreate or invoke the daily scheduler and does not broaden execute or object privileges.

## Activation requirements

`source_status`: **prepared and synthetic-PG17-tested only**.

`schema_activation_status`: **gated**. A parent-approved private PostgreSQL workflow must first confirm the exact target wrapper state, role/ACL metadata, policy inventory, and migration order. Environments on neither exact guarded baseline must stop for source/inventory reconciliation; this migration must not be force-applied, altered to match live text, replayed through `db:push`, or used as a substitute for provider metadata review.

The parent/integrator owns manifest and readiness harmonization. This change makes no claim that migration `0023` is installed, that a provider function/scheduler ran, or that the resulting health status was observed on a managed database.

## Focused regression drill

`operations/tests/cba10-policy-health.pg17.py` is opt-in and creates a unique PostgreSQL 17 cluster bound only to `127.0.0.1`. It receives no DSN or `.env`, creates no application/account rows, and removes the cluster in `finally`.

Run from the repository root with the explicit Node 22 path:

```bash
env -i PATH=/home/ubuntu/.nvm/versions/node/v22.23.4/bin:/usr/bin:/bin \
  HOME=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 CI=1 \
  CIRCLES_CBA10_LOCAL_PG17=1 /usr/bin/python3 -B \
  operations/tests/cba10-policy-health.pg17.py
```

The drill replays 16 reviewed source migrations into each synthetic database, materializes the exact 96- and DB09-derived 86-policy fixtures, and proves all of the following against real PostgreSQL catalogs:

1. Both complete supported multi-policy states initially expose the known false policy-health result and become healthy after `0023`.
2. An extra policy, an altered policy expression, and a removed policy each fail closed; restoring the exact state restores healthy output.
3. The health function OID, postgres owner, `SECURITY DEFINER`, fixed search path, postgres-only ACL, history continuation, direct-execute denial for runtime/browser roles, and a test-owned Cron sentinel remain unchanged.
4. A second application and an unreviewed wrapper body refuse without mutating the function.

This is source-equivalent synthetic PostgreSQL evidence only. It is not production SQL, provider/scheduler verification, migration activation, real-account proof, native proof, or application-service proof.
