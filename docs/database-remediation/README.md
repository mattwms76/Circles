# Database remediation register — 28 October 2026

_Pre-activation engineering snapshot at13:03UTC. Subsequent guarded live results belong to the separately delivered activation report/ledger; this source record is not a claim that the new four operations have already run._

Source implementation, isolated proof, production activation and complete recovery are separate outcomes. The seven reviewed Phase1 operations, pin completion and daily-monitor extensions were applied and verified on27October after the encrypted recovery checkpoint. Never replay those successful operations to erase subsequent intentional schema work.

## Approved current-schema reconciliation

On28October the owner explicitly confirmed that the new schema and authorization changes must be preserved. The current boundary includes27 app tables, nine admin tables, five publication tables, operational history and the optional identity map:42/43 durable relations. It includes the receipt's sixth `id bigint GENERATED ALWAYS AS IDENTITY` column and surrogate PK, unchanged actor/operation business uniqueness, the new review-handoff and publication tables,23 current admin routines and the detached staged NOLOGIN principal. No removed runtime membership is silently restored.

The integrated exact app/admin auditor accepts only the captured complete current contract or separately enumerated historical contracts. It does not turn unexpected tables, functions, ACLs, predicates, role capabilities or membership edges into broad exceptions. A fresh read-only run passes those authorization boundaries; provider-wide future-function defaults still fail and authoritative automatic gateway exposure remains unknown.

The publication claim uses a private four-business-column insert projection, never a second exported migration table, so generated identity/default fields are omitted without weakening canonical six-column metadata. Eight real isolated HTTP cases now cover both receipt shapes, retries and a generated bigint beyond the safe-integer boundary; the surrogate never enters the public DTO.

Runtime receipt readiness, Drizzle metadata and guarded helper/daily-wrapper candidates now recognize the three explicit reviewed receipt states, including the six-column surrogate state. They retain exact column/type/nullability/identity/constraint/index and privilege checks. Native PG17 proof covers legacy/current positives, drift refusals, preserved helper/wrapper OIDs and ACLs, and refusal to replay the new migrations. The already-applied historical SQL is unchanged.

Three separate concurrent index candidates cover `review_handoffs(assignee_operator_id)`, `circlePrompts(updatedBy)` and `promptPosts(circleId)`. They leave the original twelve-index migration unchanged. Their portable native proof rejects wrong owners, FK semantics, partial/expression/invalid indexes and in-transaction execution.

A newly demonstrated bug in the media-key CHECK uses PostgreSQL-invalid repetition `{0,511}`. The separate guarded compatibility SQL preserves the intended ASCII1–512-character/no-double-dot language and all other table/security properties. Its native proof includes147 language-oracle cases, nine guard refusals and five nonempty rows; no production row fixture is used. Backup proof distinguishes the captured zero-media baseline from prospective fixed, nonempty media export/restore.

## Connectivity and recovery gates

The protected replacement is synchronized at config8/secret3; verified TLS, restricted runtime initialization and a private-app read probe pass. No shared provider password, JWT, media key or signing key was rotated. The owner saved the existing private GitHub backup secret through the browser on28October; only its update metadata was observed. The connector's403 on repository-secret operations was not bypassed or treated as a successful secret write. A successful real backup remains the functional verification.

The recovery candidate pins complete pre/post-index42/43 TOCs and all required definitions. Its local full suite ran132 tests:129 passed and three obsolete historical archive-generator replays were explicitly skipped. Four new native tests exercise exact captured/prospective media states, complete archives, marker-proven isolated restore and metadata/TOC tampering. Historical archives require their verified matching producer commit; those skips are not latest-reader historical-restore proof. The final review's producer-binding gap is now closed by a mandatory immutable producer, separately trusted expected producer, code-owned contract digest, actual archive-selected variant and exact media CHECK/data-state binding. Missing, unknown, mismatched or tampered bindings fail before target database access. Real checkpoint40691666964 now passed actual43-table export, isolated restore, encryption and private delivery on producer `e18ccfe`; its exact contract/variant/producer attestation, immutable tag and allthree encrypted asset digests were independently verified. Fresh owner-key decryption and complete provider/media recovery are not claimed.

All new live SQL still awaits final exact-source hosted CI and fresh matching catalog guards; the current-scope checkpoint gate has passed. No live repair, user-row deletion, seed, restore, broad role grant, schedule change, provider setting or application publication is inferred from the schema-preservation approval.

## Original issue register

| Issue | Delivered / verified                                                                                                                             | Remaining boundary                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| DB-01 | Exact legacy privacy candidate and synthetic RLS proof.                                                                                          | Material compatibility/privacy choice; no live legacy-policy change.                                                   |
| DB-02 | Dedicated principal staged NOLOGIN; repaired current connection and restricted-role probe. Current detached state is preserved and audited.      | Protected separate credentials, consumer ownership and coordinated LOGIN/cutover remain unactivated.                   |
| DB-03 | Pool checkout/session cleanup, executable-SQL and release hardening, native PG17/API proof.                                                      | Trusted-server authorization is not actor-scoped RLS; publication is separate.                                         |
| DB-04 | Eleven original historical constraints validated in production, invalid-history refusals.                                                        | No unvalidated constraints in the current captured catalog; no row repair needed.                                      |
| DB-05 | Closed original and approved-current integrated app/admin authorization profiles; current live authorization checks pass.                        | Provider-default/gateway findings are not suppressed. Future unknown states fail closed.                               |
| DB-06 | Private-function EXECUTE remediation and gated global-default tooling.                                                                           | Provider-owned `supabase_admin` default needs appropriate authority.                                                   |
| DB-07 | Twelve original FK indexes installed; three new exact concurrent candidates and portable native refusal proof.                                   | New three await current-scope checkpoint/activation. No indexes dropped.                                               |
| DB-08 | Two original invoker helper paths hardened and verified.                                                                                         | Newly captured admin helpers are independently inventoried, not granted arbitrary authority.                           |
| DB-09 | Twelve original policy groups consolidated with equivalence proof. Approved later closed-table policies are preserved by current exact profiles. | Never remove the newer policies to restore an old count.                                                               |
| DB-10 | Read-only workload-aware review; zero-scan indexes preserved.                                                                                    | Representative workload evidence before any removal.                                                                   |
| DB-11 | Original PK installed; approved current surrogate preserved. Drizzle now uses precision-safe bigint and unchanged business UNIQUE.               | Exact helper/daily compatibility activation is gated, not a rewrite of receipt data or history.                        |
| DB-12 | Verified27October37/38 checkpoint;42/43 source/native reconciliation and pre-access producer/contract binding delivered.                         | Current43-table checkpoint verified; external media, fresh owner-key continuity and provider recovery remain separate. |
| DB-13 | Seven zero-row schema probes returned406/PGRST106; authoritative capture tool delivered.                                                         | Automatic API exposure settings still unobserved; no setting invented.                                                 |
| DB-14 | Original protected helper and daily monitor installed and previously healthy; new exact receipt/helper/wrapper native proof delivered.           | Live six-column reconciliation and subsequent real health verification await gates. Cron/history are preserved.        |
| DB-15 | Atomic direct-conversation/participant writes with isolated real HTTP rollback/concurrency proof.                                                | Production API release is separate; no fabricated live repair.                                                         |
| DB-16 | Bounded cleanup and operator-only dry-run-first retention tooling with capped-delete proof.                                                      | Specific horizons/holds/destructive invocation remain unapproved; nothing purged/scheduled.                            |
| DB-17 | Same-Circle pin FK and supporting indexes installed and validated, with native parent/delete proofs.                                             | Seven live-history deletion/tombstone choices remain pending; no history cascade/normalization.                        |

## Reproducible validation

Use credential-free source diagnostics,905 regression tests, remediation contracts, lint and API compilation. CI additionally runs the repository's disposable native SQL and real HTTP/router/service/PG17 drills plus unsigned Web/iOS/Android bundle compilation. The new portable drills are:

```sh
/usr/bin/python3 -B operations/tests/db14-current-receipt.pg17.py --local-pg17
/usr/bin/python3 -B operations/tests/current-feature-fk-indexes.pg17.py
/usr/bin/python3 -B operations/tests/media-objects-key-regex.pg17.py
```

Managed canonical main and separately authorized GitHub main/history remain independent and intact. Validate a tree-equivalent branch; never overwrite newer GitHub main. Exact-source CI, real-account/native proof, published API readiness and complete recovery are not interchangeable.
