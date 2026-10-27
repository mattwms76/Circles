# SEC27 local operations drills — source-only, not activated

This document describes executable local drills added for SEC27. They are synthetic-only and do **not** configure a provider, schedule a Cron job, create a watchdog, send an alert, contact a database by default, read a DSN, use a production account, read a production signing key, or change backup retention/key custody.

The preparation does not close the provider-retention, owner-controlled key-custody, managed backup, existing-private-watchdog, or external-alert-delivery gates. Those gates require separate owner authorization and independently observable evidence.

## Future-only atomic SQL transport

`operations/security-tools/sec27-future-migration-transport.mjs` is an import-only helper. It has no CLI mode that accepts a connection target and never creates a database client. Its sole execution API is:

```js
const receipt = await applyFutureOnlyMigrationBundle({
  pgClient, // already-connected parent-owned transaction-capable client
  repositoryRoot, // reviewed checkout root
  manifestRelativePath, // immutable JSON manifest outside operations/migrations/
  recordReceipt, // optional parent-owned post-COMMIT receipt recorder
});
```

The JSON manifest format is `circles-sec27-future-migration-manifest-v1`. It must have contiguous ordinals starting at `1`, unique repository-relative SQL paths under `operations/future-migrations/`, and lowercase SHA-256 digests. The helper reads every SQL file and checks every digest before `BEGIN`. It then executes exactly one passed-client transaction:

1. `BEGIN`
2. each verified SQL byte sequence in manifest order
3. `COMMIT`
4. only after a confirmed commit, return and optionally record the receipt bound to the ordered checksum set

A statement failure causes `ROLLBACK`; a `COMMIT` failure is classified as ambiguous and retry-forbidden. The helper does not write migration history, infer success from catalog objects, use installed migrations, or retry an ambiguous operation.

### Parent PostgreSQL seam (not exercised here)

A parent owner with an independently supplied disposable local PostgreSQL 17 client can use this exact API to build the required rollback fixture. That parent must create only synthetic schema/object names and a future-manifest fixture, establish a baseline, make the final manifest SQL statement deliberately invalid, and compare the isolated catalog after the returned rollback error. The present source work does not create that fixture, open a PostgreSQL connection, or execute SQL against any server.

## Actual local encrypted-media rehearsal

`operations/security-tools/sec27-local-recovery-drill.mjs` performs real local AES-256-GCM encryption/decryption using Node's maintained `node:crypto` implementation. It creates a mode-0700 temporary directory and only generated dummy key material, synthetic media, and synthetic metadata inside it. It then:

- encrypts two synthetic media objects and writes a private manifest;
- decrypts/restores both objects and compares their SHA-256 and byte lengths;
- rejects a corrupted ciphertext, wrong generated key material, and a missing encrypted object;
- recursively removes the private temporary directory before returning a value-free proof.

It has no input for a real key, live media, export, database row, account, provider endpoint, or recovery identity. Its JSON result contains only booleans, counts, and a SHA-256 of the dummy manifest.

## Pure health/watchdog transition drill

`operations/security-tools/sec27-health-watchdog-evaluator.mjs` exports a deterministic evaluator and a three-case drill. It accepts only synthetic freshness category, aggregate-health boolean, integer lag, and synthetic incident-open state. It does not read time, make I/O, create a schedule, configure a watchdog, or send an alert.

The drill evaluates one stale case and one unhealthy case to `condition_open`, then a fresh/healthy case from an open state to `condition_recovered`. Each result explicitly marks delivery as mocked with zero external attempts. This is source-level behavioral evidence only; it does not prove the existing private watchdog ran, a scheduled health job ran, or an external destination received an alert.

## Boundaries and expected local counts

The focused executable test suite exercises one successful two-statement passed-client transaction, one deliberately failed passed-client transaction with rollback, and three pre-`BEGIN` manifest rejections. The recovery rehearsal has exactly two synthetic metadata records and two media objects; it verifies two restored checksums and three negative cases. The watchdog drill has exactly three synthetic transitions, three mock delivery records, zero external delivery attempts, zero scheduler/database queries, and a maximum synthetic lag of 61 minutes.

Run only the focused test file in the Node 22/pnpm 9 environment:

```sh
pnpm exec vitest run tests/sec27-operations-drills.test.ts --maxWorkers=1
```
