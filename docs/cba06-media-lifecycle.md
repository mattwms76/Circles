# CBA-06 media upload lifecycle

## What this repair enforces

`social.upload` now validates and encrypts input, then **durably reserves provider capacity before calling `storagePut`**. The reservation charges the actual encrypted object length, including the 36-byte Circles framing overhead. The hard account aggregate is **64 object attempts** and **512 MiB reserved bytes**. The database update is conditional and transactional, so concurrent application instances cannot bypass either limit.

A reservation begins as `put_started`. This state is intentionally conservative: after a PUT attempt, a provider object may exist even if the application receives an error, is cancelled, or cannot record follow-up metadata. A successful response transitions it to `uploaded`; a successful `socialUploads` metadata transaction transitions it to `recorded`. No lifecycle transition decreases the account charge.

The current storage adapter exposes GET and PUT capability only. This repair does **not** invent or invoke a provider DELETE endpoint, an object-store retry/outbox, a retention cleanup, or a quota refund. In particular, `discardUpload` still removes only caller authorization metadata. Its corresponding durable reservation remains charged. Reconciliation derives that state through the missing `socialUploads` row, rather than deleting the ledger row.

## Schema activation gate

`operations/migrations/0025_circles_media_upload_budget.sql` is additive and prepared only. It creates the private `circles_media."socialUploadBudgets"` and `circles_media."socialUploadReservations"` tables, backfills currently recorded `socialUploads` rows as charged reservations, enables RLS, and grants only the existing runtime role. It does not alter baseline migrations, delete application data, contact storage, or activate a scheduler.

Until this migration is applied through the authorized private PostgreSQL workflow, upload admission fails with `PRECONDITION_FAILED` **before any storage PUT**. `isMediaUploadBudgetReady` is an internal safe boolean for owner-controlled readiness wiring; it is intentionally not included in public/social discovery DTOs. Integrators must align the new tables and policies with the private schema-health, recovery, and backup inventories before live activation.

The migration cannot reconstruct provider objects whose authorization metadata was already discarded before activation. Such historical objects remain an operator/provider-inventory concern. It backfills only the known metadata rows and is intentionally fail-closed if their byte contract is incompatible.

## Bounded dry-run reconciliation

`listMediaUploadReconciliationCandidates` is a server-private, operator-only dry-run helper. It returns at most 200 old candidates per call, ordered by `(putStartedAt, reservationId)` with a continuation cursor. It identifies:

- `unknown_after_put_attempt`: `put_started` older than 24 hours;
- `orphaned_after_put`: acknowledged `uploaded` records lacking a completed metadata transaction;
- `discarded_metadata`: old `recorded` reservations whose `socialUploads` authorization row is absent.

The helper makes no writes, has no public router procedure, does not schedule itself, and never frees capacity. Any provider inventory, physical deletion capability, confirmation, remediation action, or later accounting release requires separate approval and validation.

## Isolated validation

The dedicated runner below creates a fresh PostgreSQL 17 cluster bound to `127.0.0.1`, applies only the CBA-06 prerequisite migrations, activates 0025 only inside that synthetic fixture, and removes the cluster afterward:

```sh
env -i PATH=/home/ubuntu/.nvm/versions/node/v22.23.4/bin:/usr/bin:/bin \
  HOME=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 CI=1 NODE_ENV=test \
  VITE_CONFIG_NATIVE_IGNORE_WARNING=true \
  /home/ubuntu/.nvm/versions/node/v22.23.4/bin/node \
  e2e/cba06-media-upload-budget.runner.mjs
```

It executes absent-schema fail-closed admission, legacy backfill, 65 concurrent reservations (64 admitted; one denied), metadata-record failure retention, and discarded-metadata dry-run accounting. The provider is never contacted; no user account, native runtime, production database, or live schema is used.
