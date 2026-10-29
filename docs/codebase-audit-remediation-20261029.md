# Codebase audit remediation — 29 October 2026

All 14 retained audit IDs have source repairs or guarded forward SQL preparations. CBA-09 was a package-manager false positive and remains excluded. This guide separates implemented source from live installation, provider reclamation and native/account evidence.

## Finding-by-finding implementation

| ID     | Source repair                                                                                                                                                           | Remaining activation or evidence boundary                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| CBA-01 | Host-authoritative WebRTC peer reconciliation; membership/lease/generation revalidation and stale-signal rejection.                                                     | Router and web/native adapters must roll out together. Real WebRTC/TURN/device proof remains open.                                      |
| CBA-02 | Every profile, cover, post and message upload claim shares discard's row lock and requires a successful claim update.                                                   | Real PostgreSQL interleavings are tested locally; provider storage proof remains open.                                                  |
| CBA-03 | Legacy member/comment lists capped at 50; exact-time `commentsPage` pagination, visible continuation and foreground invalidation.                                       | Real PostgreSQL public/private access and tied-time traversal are tested. Native/account UI proof remains open.                         |
| CBA-04 | Atomic live-chat/reaction admission, retention and burst caps; matching ordered indexes.                                                                                | Forward index migration 0024 remains unapplied.                                                                                         |
| CBA-05 | Native private-cache cleanup errors propagate; failed logout cleanup keeps credential admission fenced.                                                                 | Mocked Expo APIs only; physical cache behavior remains unverified.                                                                      |
| CBA-06 | Durable reserve-before-PUT accounting, 64 object-attempt / 512 MiB account ceilings, conservative unknown/orphan/discard charging and bounded reconciliation inventory. | Migration 0025 remains unapplied. Actual provider inventory/deletion and live encrypted-backup activation remain separately gated.      |
| CBA-07 | Supervisor requires verified process-group emptiness before clean stop and lock release, including TERM-ignoring descendants.                                           | Synthetic Linux/procfs proof only; no host supervisor installation.                                                                     |
| CBA-08 | Continuity helpers have bounded TERM→KILL escalation and rejection even without a close event.                                                                          | Real local helper/cleanup tests only; no live export or restore.                                                                        |
| CBA-10 | Forward policy-health repair accepts only exact reviewed 96-policy or consolidated 86-policy states, preserving receipt-wrapper authority.                              | Migration 0023 remains unapplied; unknown wrappers are refused.                                                                         |
| CBA-11 | Public readiness distinguishes core `ok`, `liveRelay`/`liveReady`, and `mediaUploadBudget`/`mediaUploadReady`.                                                          | These are capability/configuration booleans, not TURN reachability or real provider proof.                                              |
| CBA-12 | CI checks tracked-source formatting immediately after locked installation.                                                                                              | Hosted exact-source CI must be observed separately.                                                                                     |
| CBA-13 | Narrow Messages hides the intentionally non-tabbed bottom bar; no Chats tab was added.                                                                                  | Mocked native render proof; actual screen-reader/device proof remains open.                                                             |
| CBA-14 | CircleCard has one accessible Open action while retaining pointer image navigation and independent membership actions.                                                  | Mocked accessibility-tree proof only.                                                                                                   |
| CBA-15 | HTTPS web sessions issue/accept only `__Host-` identity cookies. Logout expires host-only and configured parent-domain historical variants.                             | Generic-cookie sessions require deliberate reauthentication. Actual sibling-domain/browser ordering and native login proof remain open. |

## Private ledger and recovery contract

The new ledger is in **`circles_media`**, not `circles_app`. The existing exact 27-table application catalog, all historical migrations, receipt compatibility, native identifiers, signing/media keys, dependencies, fixed ports and disabled publication are preserved.

`server/media-upload-budget-contract.ts` checks a closed catalog contract: exact schema ownership/ACL, columns, types, nullability, constraints, indexes, forced RLS and runtime-only policy/privilege shape. Missing, partial or drifted storage causes upload admission to fail **before provider PUT**. Core feeds/auth/DM availability is not represented as successful upload readiness.

`operations/recovery/database-recovery-manifest.json` contains a separate prepared ledger group. The source-only checker validates its exact table/source paths, ordered SQL fingerprints, private encrypted-backup classification, API-role exclusions, isolated restore target and explicit unverified activation state. It does not add prepared tables to the pinned installed catalog or imply an archive exists.

The exact backup extension is recorded in `operations/recovery/cba06-private-media-ledger-backup-scope.json` and the operator guide beside it. Ledger/account/storage-reference rows belong only in a private encrypted archive, never public DTOs, reports or plaintext logs. Provider media bytes and owner-controlled key material remain separate recovery scopes.

## Guarded rollout order

1. Review current private target metadata and a current authorized encrypted recovery checkpoint. Preserve every historical SQL file byte-for-byte.
2. Review migration **0023** against the exact supported daily-health wrapper, owner, ACL and 96/86 policy inventories. It refuses unknown states and does not change Cron.
3. Review migration **0024** for ordered live-chat indexes.
4. Review migration **0025** for the private ledger schema, least privileges, conservative legacy metadata backfill and isolated recovery coverage.
5. Apply none of these files without separate authorization. `operations/migrations/cba06-ordered-rollout-manifest.json` records their source order and SHA-256 values; it is not an execution approval.
6. After authorized installation, verify private-ledger capability metadata before enabling upload-dependent use. Until then uploads are intentionally unavailable rather than bypassing the durable budget.

No automatic provider deletion/retry is invented. Unknown objects retain their charge; elapsed time and deleted authorization metadata are not evidence of storage deletion. Objects whose metadata was discarded before ledger installation require a separately authorized provider inventory/reclamation decision.

## Validation boundaries

Focused source, real loopback PostgreSQL/HTTP, concurrent reservation/flood/claim drills and an independent integration review are available. Earlier failing formatter/test results are retained outside Git and corrected rather than hidden. Final whole-source validation is recorded in the parent delivery evidence.

Web/iOS/Android **JavaScript** exports use validation-only `--no-bytecode` because this ARM sandbox cannot execute Expo's packaged x86-64 Hermes compiler. Shipping Hermes/native configuration is unchanged. These exports do not prove Hermes bytecode, signed builds, physical keyboard/camera/cache behavior, real authentication, TURN networks, provider object reclamation, live backups, migration installation, checkpoint recording or publication.

## Final available source evidence

The final full suite passed **1,188 tests in 241 files**, strict unused TypeScript, zero-warning ESLint, complete candidate formatting, API build, environment and database source checks. All 12 disposable PostgreSQL fixture suites cleaned up; publication passed 11 cases, media-ledger lifecycle passed 8 cases including four runtime-role drift variants, and exact policy-health passed seven semantic checks. Three target JavaScript exports passed with the documented no-bytecode limitation. The late server-only role guard was followed by full-unit, type, scoped lint, recovery, ledger/publication PG17 and API-build rechecks.

CI now includes the new real pagination, claim/discard, chat flood, ledger quota/role and exact-policy drills using its existing pinned PostgreSQL toolchain. A hosted CI result is not claimed from local execution. The independent review's cookie-cleanup and ledger-role hardening gaps were resolved and tested. Historical failed evidence remains outside Git.
