# Current-feature foreign-key index reconciliation

## Status and scope

`operations/remediation/current_feature_fk_indexes.sql` is a **new, unapplied operational candidate**. It closes exactly the three currently cataloged child-side foreign-key index gaps listed below. It is separate from, and does not amend, the applied/original DB-07 twelve-index history.

The contract is derived from the sanitized schema-only input `current-private-schema.sql` and `current-contract-catalog.json` captured on 2026-10-28. The listed constraints are validated in that metadata, and the sanitized current catalog reports these three, and only these three, as missing a child-side covering index.

| Child table                       | Exact reviewed FK                           | Exact child column/type         | Reviewed parent and delete action                   | Required index                                |
| --------------------------------- | ------------------------------------------- | ------------------------------- | --------------------------------------------------- | --------------------------------------------- |
| `circles_admin.review_handoffs`   | `review_handoffs_assignee_operator_id_fkey` | `assignee_operator_id` / `uuid` | `circles_admin.operators(id)` / `ON DELETE CASCADE` | `review_handoffs_assignee_operator_id_fk_idx` |
| `circles_publish."circlePrompts"` | `circlePrompts_updatedBy_fkey`              | `updatedBy` / `integer`         | `circles_app.users(id)` / `ON DELETE RESTRICT`      | `circle_prompts_updated_by_fk_idx`            |
| `circles_publish."promptPosts"`   | `promptPosts_circleId_fkey`                 | `circleId` / `integer`          | `circles_app.circles(id)` / `ON DELETE CASCADE`     | `prompt_posts_circle_id_fk_idx`               |

This candidate is additive and creates no rows. It never deletes or normalizes data and never drops, replaces, reindexes, or alters an existing index. It does not change a foreign key, table schema, constraint, owner, role, grant, RLS policy, function, schedule, publication, backup configuration, or original migration/history file.

## Guarded execution contract

Only a parent-approved recovery gate may authorize an operational invocation. Run through `psql` with autocommit enabled:

```sh
psql -X -v ON_ERROR_STOP=1 \
  -v current_feature_fk_indexes_confirm_no_transaction=1 \
  -f operations/remediation/current_feature_fk_indexes.sql
```

Do **not** use `--single-transaction`, wrap the file with `BEGIN`/`COMMIT`, or route it through a transaction-opening migration runner. The three `CREATE INDEX CONCURRENTLY` statements must remain top-level autocommit statements; PostgreSQL refuses them inside a transaction block. The script requires an explicit psql acknowledgement variable, uses a five-second `lock_timeout` and thirty-minute `statement_timeout`, and takes a non-blocking session advisory lock. A timeout, advisory-lock conflict, or validation failure is a stop condition, not permission to retry, drop, rebuild, or broaden scope.

Before any creation, the session-local validator requires every reviewed child and parent schema/table to be a regular/partitioned table owned by `postgres` in a schema owned by `postgres`. It validates each named FK's child and parent relation, one-column order, exact type, validated status, deletion action, update action (`NO ACTION`), match mode (`SIMPLE`), and non-deferrable shape.

If one of the three required index names already exists, it must be exactly the required single-key, non-unique, non-primary B-tree on the reviewed child table/column, also owned by `postgres`. The validation checks its access method, default `pg_catalog` operator class (`uuid_ops` or `int4_ops`), source-column collation, ascending/nulls-last option bits, no predicate, no expression, single-key width, validity, readiness, liveness, and exact `pg_get_indexdef` value. A wrong object fails before `IF NOT EXISTS` can suppress creation and is checked again after every concurrent create. The candidate deliberately preserves an invalid/partial same-name index for diagnosis; it does not remove or repair it.

## Credential-free validation

The focused static test reads only the candidate SQL, original DB-07 candidate, and sanitized catalog input. It takes no DSN and makes no database connection:

```sh
env -i PATH="$PATH" HOME="$HOME" CI=1 \
  node --test operations/tests/current-feature-fk-indexes.node.mjs
```

The native proof starts a disposable loopback PostgreSQL 17 cluster using only `/usr/lib/postgresql/17/bin`, executes the actual candidate file through `psql`, and removes the fixture directory afterwards. It accepts no command-line target or DSN:

```sh
env -i PATH="$PATH" HOME="$HOME" CI=1 \
  /usr/bin/python3 operations/tests/current-feature-fk-indexes.pg17.py
```

The PG17 drill uses synthetic schemas and rows only. It proves that:

1. a same-name index on the wrong child column is rejected before any additional target index is created;
2. a same-name FK with a wrong parent/deletion contract is rejected before any target index is created;
3. a `psql --single-transaction` invocation fails because concurrent index creation is prohibited in a transaction block;
4. a normal invocation creates all three exact `pg_get_indexdef` values, each valid, ready, live, single-key, unpredicated, non-expression B-tree; and
5. a normal rerun is safe and leaves the synthetic rows and related non-target index inventory unchanged.

This drill is not a production, preview, provider, backup, or user-data test. It does not authorize live DDL.

## Parent-controlled operational gate

Before any live execution, the parent owner must obtain a fresh sanitized read-only catalog preflight that confirms the exact three FK/table/index contracts above, current ownership, and absence of conflicting same-name objects. The parent must also approve the maintenance/monitoring window, five-second lock budget, and thirty-minute statement budget, then retain the isolated PG17 proof for the exact candidate revision.

After an authorized run, the parent must perform a read-only metadata-only postflight that records only the three index names and their valid/ready/live exact definitions. Do not export row data, credentials, provider settings, or unbounded catalog output. This candidate contains no live apply authority and no health, audit, backup, privacy, deletion, cascade, or publication authority.
