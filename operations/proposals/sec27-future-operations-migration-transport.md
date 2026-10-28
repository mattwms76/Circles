# SEC27 future operations migration transport

This is a **parent-owned, future-only transport contract**. It does not install a runner, execute SQL, modify a database, change grants, alter `identity0014`, or schedule work. It must not be used to retry, replace, or edit an already applied migration.

The applied `operations/migrations/0001_circles_ops_daily_migration_health.sql` remains immutable. Its source SHA-256 at this review is:

```text
0df6a1076b9adc01e180bb06fca3cb242711038e7b36e5bf36188819ea2ad888
```

No future transport may rewrite that file, rewrite installed migration history, infer completion from object existence, or run `db:push` against the private operations boundary.

## Required parent transport contract

Before a future reviewed operations migration is submitted, the parent must create an immutable manifest outside the migration directory. The manifest must include one contiguous, strictly increasing ordinal per reviewed file, the repository-relative path, and the SHA-256 bytes of each exact file. It must be checked against the reviewed source before opening a database connection. Duplicate ordinals, duplicate paths, path traversal, missing files, checksum mismatch, or an order gap must fail before transport.

The parent must submit the ordered reviewed bundle through one transaction-capable migration transport. The entire bundle must fail closed and roll back if any statement fails. The success receipt must bind the exact ordered manifest and checksum set to the transport result before installed-history metadata is recorded. A receipt without a confirmed transaction outcome is not proof of application, and an ambiguous response must be inspected through bounded metadata rather than retried blindly.

The parent must not add automatic recovery, global grants, a second health Cron, a watchdog, a production fixture, or a repair step to this transport. Existing health Cron job 7 and the documented private watchdog remain outside this proposal.

## Required synthetic rollback drill

Before authorizing a new future bundle, run a disposable local PostgreSQL 17 drill using synthetic schema/object names and no production connection or rows. First establish the baseline fixture. Then pass a deliberately invalid final statement only through the same single-transaction transport path used for the reviewed bundle. The drill passes only when the transport reports failure and the isolated catalog equals the pre-transport baseline: no partial object, ACL, function, table, record, or applied-history marker remains. Retain only value-free evidence containing the manifest checksum set, expected rollback classification, and cleanup result.

A separate successful synthetic run must prove the exact manifest ordering/checksum validation occurs before transport and records a receipt only after commit. It must not use an installed production migration as test input. The tests for this contract are deliberately prepared but not installed or executed by this remediation task; actual runner integration, local PostgreSQL fixture execution, and migration application remain parent gates.
