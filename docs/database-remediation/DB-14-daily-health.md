# DB-14 — Daily health extension

## Status and scope

`operations/remediation/db14_daily_health_extension.sql` is a **prepared, unapplied** extension. It does not contact a provider, read credentials, create data fixtures, alter a scheduler, or run automatically. Parent approval remains required after the recovery gate before any private PostgreSQL execution.

The extension changes the existing `circles_ops.run_daily_migration_health()` in place. It retains the previously reviewed `critical_feature_contract` addition and reconciles the obsolete one-policy-per-table health predicate with the approved application/admin policy contract. It does **not** create or change RLS policies, product authorization, schemas, roles, tables, jobs, history rows, retention behavior, or a wrapper function.

## Exact guarded baseline

The precondition uses the metadata-only 2026-10-27 catalog capture at `/home/ubuntu/circles-all-phases/evidence/prechange-catalog.json` as its live baseline:

- exact `pg_get_functiondef()` MD5: `a4421c8c4e64f1700f2a2771624ecfa0`;
- exact `prosrc` MD5: `e508c15fe21081e43c41810df71b5677`;
- 35,166-byte captured definition;
- owner `postgres`, `SECURITY DEFINER`, `search_path=pg_catalog`, and ACL `{postgres=X/postgres}`.

It requires a postgres session/current role, precisely one zero-argument daily-health signature, and precisely one zero-argument critical-helper signature. The helper must retain its reviewed owner, definer/path/ACL metadata and fixed body hash. A missing helper, extra overload, altered baseline, altered helper, ACL/path/owner drift, or an unreviewed installer role raises an exception before any dynamic replacement.

Within one transaction, the SQL takes its own advisory lock and bounds lock waiting to two seconds and statements to 15 seconds. It transforms the captured live definition at **two separately verified unique anchors**:

1. the obsolete `v_policies_ok` count-equals-one block; and
2. the retained `critical_feature_contract`/`v_checks` addition.

No independently maintained 35 KB function copy is present. If either anchor is absent or duplicated, the transaction raises before executing `CREATE OR REPLACE`. The postflight requires the same function OID, exact generated definition, owner, `SECURITY DEFINER`, fixed path, and direct ACL as immediately before execution. The existing return columns, sanitized exception behavior, 90-day history retention, history table, and daily function identity remain unchanged.

## Closed policy reconciliation

The first anchor replaces only the stale daily **health check**, not any policy DDL. Its static expected rows are generated from the reviewed `POLICY_CONTRACT_VARIANTS` in `scripts/circles-database-security-contract.mjs` and encode exactly these two complete `circles_app` states:

| Accepted state                                     | Rows | Tables | Normalized SHA-256                                                 |
| -------------------------------------------------- | ---: | -----: | ------------------------------------------------------------------ |
| Current pre-DB-09 policy set                       |   96 |     27 | `88a7aef25382ea3734a30d6c3333e4b993bd95bf3befd5f312f5abce40593ae3` |
| Complete post-DB-09 twelve-group-consolidation set |   86 |     27 | `0475525cb06cf85917d7e4f5551102ab336bf765029c889ee9eeae18a4d2bb8e` |

The normalized 96-row current set exactly matches the captured catalog on table, policy name, sorted role names, command, permissiveness, normalized `USING` qualification, and normalized `WITH CHECK` qualification. The post state removes exactly ten approved app-policy records from that current state; it is not a permission-count threshold or an open-ended allowance.

At runtime the replacement normalizes and compares **every** `pg_policy` row on all expected app tables against either complete set using both directional `EXCEPT ALL` comparisons and cardinality equality. It therefore rejects added policies, changed policy fields, arbitrary extras, and incomplete/partial consolidation. Both accepted states retain the restrictive `circles_app_deny_anon_authenticated` policy for `anon, authenticated` on every one of the 27 app tables; the related direct API/browser privilege checks elsewhere in the daily routine remain unchanged.

## Isolated PostgreSQL 17 rehearsal

The opt-in proof is isolated and does not accept a DSN or `.env` input:

```bash
env -i PATH="$PATH" HOME=/tmp LANG=C.UTF-8 \
  CIRCLES_DB14_DAILY_HEALTH_EXTENSION_LOCAL_PG17=1 \
  /usr/bin/python3 -B operations/tests/db14-daily-health-extension.pg17.py
```

The verified run uses a fresh loopback-only PostgreSQL 17 cluster, a stripped child environment, source-migration replay, and a test-owned `cron.job` row 7 sentinel (`15 3 * * *`, `postgres`, active). It resolves Node from the installed toolchain's PATH. The fixture obtains its complete application policy rows from the reviewed contract and verifies the actual captured 96-row state through the independently pinned tuple digest `1dc3333f36739e281f2a0587d11e509aedb5ba804c588c6ca09c9e58f9aaa449`. The digest input is the sorted seven-field policy tuple representation encoded as compact UTF-8 JSON; no sandbox-only catalog file is needed. It does not remove the browser-denial policy to obtain a passing result.

The 2026-10-27 bounded run passed:

- healthy current (96-row) and exact post-consolidation (86-row) policy states;
- preserved daily-function OID, owner/definer/path/ACL metadata, history append behavior, and synthetic job-7 tuple;
- direct execution denial for `circles_app_runtime`, `anon`, and `authenticated` for both protected health functions;
- fail-closed added, changed, partial, and browser-denial-policy drift cases, followed by healthy exact-state recovery;
- negative critical-feature drift with continued history and unchanged synthetic job 7;
- double-apply, altered-old-definition, missing-helper, extra-overload, and unreviewed-installer-role refusals.

The test removes its disposable cluster directory in `finally`. It is local functional evidence only; it is not a provider connection, a production write, or a live scheduler operation.

The portable invocation passed all of the listed gates and is included in the existing CI migration-rehearsal step. This is isolated proof, not a hosted-CI receipt or application publication.

## Important live-proof limits

No live SQL was executed and no historical health row was repaired. In particular, the latest recorded `03:15` healthy Cron result predates the later admin installer; it **must not** be described as proof that the current live policy inventory is healthy. The synthetic job-7 result likewise demonstrates non-mutation only in the isolated drill, not the current provider Cron configuration or execution.

This prepared candidate does not prove that the live function, helper, ownership/ACL, policy inventory, Cron metadata, recovery readiness, account state, or application deployment still matches at a later execution time. It does not authorize a live invocation of the daily health function.

## Required live process

1. Obtain the parent’s explicit execution approval after the recovery gate.
2. Read current private metadata and compare it to the exact guarded baseline. Treat any mismatch as stop-and-review; do not edit the SQL to force a match.
3. Independently verify the current complete app-policy catalog is exactly one of the two closed reviewed states, together with the unchanged supporting ACL checks. Do not infer validity from a policy count.
4. Apply the prepared companion `db14_integrity_health.sql` only through its separately approved path if it is not already present and verified. The extension refuses a missing or changed helper.
5. Submit `db14_daily_health_extension.sql` once as a whole transaction through the approved private PostgreSQL workflow, as `postgres`. Do not use an application migration replay, `db:push`, a browser, or a scheduler command.
6. After an authorized response, inspect bounded function metadata. Invoke the existing daily operation only if separately authorized, and compare job-7 identity/schedule/username through the approved read-only operations process. Do not recreate or alter the job.
