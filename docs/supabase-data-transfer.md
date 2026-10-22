# Private Supabase data transfer

`scripts/migrate-to-supabase.mjs` is a **parent-operated**, finite MySQL/TiDB-to-PostgreSQL copier. It only transfers the 21 explicitly allowlisted Circles app tables from `scripts/supabase-data-manifest.mjs` into the private `circles_app` schema. It does not create schemas, tables, roles, policies, public-schema objects, exports, seed data, or migrations.

The legacy `__drizzle_migrations` journal is intentionally excluded. Historical MySQL migration history is provenance only and must not be replayed as PostgreSQL history.

## Data coverage

The manifest has fixed columns, primary keys, dependency order, and identity-reset targets for every legacy app table. It includes:

- **Durable login authority:** `applicationSessions`, including fingerprints, app binding, expiration, revocation, and creation time.
- **Social state and media ownership:** users, profiles, circles, memberships, posts, reactions, bookmarks, comments, conversations, participants, messages, follows, reports, and `socialUploads` storage-key/URL ownership.
- **Exact message watermarks:** `conversationParticipants.lastReadMessageId` and `lastReadAt`.
- **Markers:** `socialSeedMarkers`, copied as application data; the transfer completion marker is kept separately in `_dataMigrations`.
- **Live context:** streams and `readyAt`, heartbeat, generation and ended fields; host leases; viewer presence/generation; persisted signals and chat.

The source inventory supplied for this cutover has 22 physical source tables and 29 rows: 21 app tables with 24 rows plus the 5-row legacy Drizzle journal. No source row values are written to this guide, tests, logs, or artifacts.

## Prerequisites and schema-owner contract

The schema/connection owner must apply DDL first. In addition to all manifest app tables and their exact column names, private schema DDL must provide:

```text
circles_app."_dataMigrations"
  "key"          primary-key text/varchar
  "sourceTree"   non-null text/varchar
  "completedAt"  non-null timestamp/timestamptz
  "summary"      non-null jsonb
```

`summary` must be `jsonb`, because the importer binds the reviewed per-table count/digest summary as JSON. Every table with a legacy auto-increment `id` must have a PostgreSQL serial/identity backing sequence resolvable by `pg_get_serial_sequence`; the importer resets each sequence only after parity succeeds. The table, marker, schema and role must remain private/RLS-protected under the approved schema migration. The importer never emits DDL to repair a mismatch.

The importer opens its target only through `server/_core/postgres-config.mjs`. That shared helper validates the authorized project, normalizes the session-pooler connection in memory, and verifies the supplied public Supabase CA. It reads `SUPABASE_DATABASE_URL` only in memory. The preserved `DATABASE_URL` is used only as the original MySQL/TiDB source and is never changed.

## Source snapshot and transfer safety

All source reads use a single bounded, keyset-paginated transaction and UTC timestamp handling. No source `INSERT`, `UPDATE`, `DELETE`, `DDL`, export, or seed action exists in the utility.

For conventional MySQL, the utility starts `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY` at `REPEATABLE READ`. For the verified TiDB source (`8.0.11-TiDB-v8.5.3-serverless`), it first identifies TiDB using `VERSION()` and uses normal `START TRANSACTION` at `REPEATABLE READ`. TiDB documents that an explicit transaction immediately establishes a snapshot and that `START TRANSACTION` is equivalent to MySQL’s consistent-snapshot start; TiDB’s `READ ONLY` syntax is compatibility syntax and does **not** database-enforce the no-write discipline. The utility therefore uses only `SELECT` after its session setup, and the parent’s explicit API write pause remains mandatory.

On the target, `--apply` opens one `SERIALIZABLE` PostgreSQL transaction, obtains an advisory lock and table locks with bounded timeouts, rejects any nonempty/nonmatching target, copies all rows in dependency order, resets identities, recomputes target digests, compares per-table counts and SHA-256 canonical digests, then writes the completion marker last. Any incompatibility, active target writer lock, copy failure, or parity mismatch rolls back the whole target transaction. There is no truncate, overwrite, or partial-marker path.

A target is accepted only when it is either completely empty with no marker, or has exactly the expected completion marker and its own data verifies against the recorded summary. Existing completion markers also require current source-snapshot parity; a changed source fails rather than being treated as a harmless rerun.

## Parent-only commands

Run these only after the parent has applied reviewed DDL. The scripts do not load `.env`; the parent supplies the protected environment at invocation time. Never paste a URL, password, row, message, session fingerprint, or digest comparison input into a shell transcript or evidence file.

```sh
node scripts/migrate-to-supabase.mjs --preflight
node scripts/migrate-to-supabase.mjs --apply --acknowledge-write-pause=I_CONFIRM_CIRCLES_API_WRITES_ARE_PAUSED
node scripts/migrate-to-supabase.mjs --verify
```

`--preflight` validates source and private-target shape, takes a source snapshot, calculates count/digest summaries, and confirms the target is empty or an exactly verified completion. It writes nothing. `--apply` is the only write mode and refuses to run without the literal acknowledgement. The parent must first stop the identified API writer and verify its write pause. `--verify` is read-only and requires both target-marker and current source parity.

`--batch-size` is optional and must be an integer from 1 through 500. The default is 250. It bounds source and target pages; it does not change the digest or copied values.

The CLI reports only mode, engine/snapshot path, target state/outcome, manifest fingerprint, and aggregate table counts. It never prints rows, raw database errors, URLs, credentials, or plaintext exports.

## Integration requests

Do **not** modify `package.json` in this unit. The package owner may add these script entries after integrating all concurrent work:

```json
{
  "db:supabase:preflight": "node scripts/migrate-to-supabase.mjs --preflight",
  "db:supabase:apply": "node scripts/migrate-to-supabase.mjs --apply",
  "db:supabase:verify": "node scripts/migrate-to-supabase.mjs --verify"
}
```

The apply entry intentionally omits the acknowledgement; the parent must append `-- --acknowledge-write-pause=I_CONFIRM_CIRCLES_API_WRITES_ARE_PAUSED` only during the controlled final transfer. No package script should convert this into an unattended operation.

## Local checks

The transfer-only test file is `tests/supabase-data-transfer.test.ts`. It uses synthetic values and mocks only. It checks inventory completeness, durable-session/marker/upload/watermark/live coverage, TiDB and MySQL snapshot selection, bounded keyset SQL, UTC canonical digest equivalence, and the apply acknowledgement guard.

```sh
env -i PATH="$PATH" HOME="$HOME" LANG=C CI=1 pnpm exec vitest run tests/supabase-data-transfer.test.ts
```

**References**

[1]: https://docs.pingcap.com/tidb/stable/transaction-overview/ "TiDB transaction overview"
[2]: https://docs.pingcap.com/tidb/stable/transaction-isolation-levels "TiDB transaction isolation levels"
[3]: https://docs.pingcap.com/tidb/stable/sql-statement-start-transaction/ "TiDB START TRANSACTION statement"
