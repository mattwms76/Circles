# Additive SQL and cross-layer validation

## Reuse these decisions, not historical migration files

Inspect current schema, migration history, runtime privileges and exact health/recovery contract. Choose appended private fields with safe defaults rather than adding unrelated tables or modifying a public schema. Reuse the existing restricted-role connection model; never add a permissive test URL override to production configuration.

Write a new health-function version if exact column shape changes. Compare it to the immediately preceding deployed definition, excluding comments: require only planned column extensions. Preserve history fallback, owner, grants, search path, retention and existing cron identity/schedule. Do not recreate a job merely to install feature columns.

Use foreign keys for target deletion cleanup when appropriate. A pointer FK by ID alone does not prove same-parent membership: retain the server-side circle-and-post predicate and authorization. Serialize updates with existing locks; keep resource pin updates separate from text/rule edits.

## Text semantics that require explicit agreement

| Seam | Required decision and regression |
|---|---|
| Length | JavaScript `Array.from(text).length` and PostgreSQL `char_length` count code points; native `maxLength` may count UTF-16 units. Avoid truncating surrogate pairs; test astral boundaries at limit and limit+1. Do not call this grapheme-cluster counting. |
| Lines | Reject CR and LF before trimming a single-rule API value. A multiline editor may intentionally split them into separate rules. State which layer accepts which representation. |
| Trim | Use the same explicit whitespace set or prove equivalence. JavaScript trim and PostgreSQL btrim defaults differ. Reject stored wrapped/blank strings rather than letting API/DB disagree. |
| Case uniqueness | JavaScript Unicode lowercasing and database locale folding can differ. Prefer an explicitly documented portable key (for example ASCII fold with other Unicode exact) unless a shared normalization policy exists. |
| JSON | CASE-guard array operations; SQL optimizer evaluation order is not a short-circuit guarantee. Reject non-arrays, non-string elements and excessive cardinality deliberately. |
| Regex | PostgreSQL ARE bounded repetition has limits (for example a `{1,300}` pattern can fail). Prefer character-length checks plus simple forbidden-character regex. Execute the actual DDL in PostgreSQL, not only a JS regex test. |
| Legacy constraints | `NOT VALID` validates future writes, not existing rows. Keep the distinction in the report and do not claim full historical conformance. |

## Disposable drill design

Create a private temporary PG data directory, init a fresh cluster and bind only to loopback on an allocated fixture port; do not accept a Supabase/user DSN. Strip inherited DB/signing/provider environment variables before startup. Load the current baseline plus only prerequisite/new migrations in verified order. Seed synthetic roles, users, parents and targets in the disposable database.

Test safe defaults, legacy fields, valid runtime updates, empty/clear operations, independent field updates, target deletion, foreign targets through the actual service, malformed JSON, max cardinality, duplicate/trim/case/newline and astral limits. Verify runtime-role privileges and API-role denial against actual catalog/RLS. Run exact schema health if the operational dependencies exist locally.

Bound startup/query/HTTP timeouts and close pools/listeners before stopping PostgreSQL in finally. Remove the fixture directory even after a failed assertion. If cleanup fails, report it as a failure; do not rerun blindly. Never export/restore production data for a synthetic migration drill.
