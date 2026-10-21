# Recovery and durable-session rollout — 21 October 2026

## Implemented scope

The reviewed exact-base recovery/security patch has been applied to the Circles source. All eleven ESLint errors are fixed through scoped lifecycle/refactoring and tooling rules rather than blanket suppression. REST and tRPC logout use durable per-presented-credential revocation; the active Profile logout path immediately clears client credentials, private caches and protected navigation, then reports remote revocation failure if necessary. Legacy stateless credentials are rejected and users must sign in again. Sessions have a random identifier, a stored fingerprint, identity/expiry binding and a maximum12-hour lifetime.

The guarded utility is available as `pnpm recover:api` and `scripts/recover-api.mjs`. The reusable skill is versioned under `skills/expo-trpc-recovery-security`; its script copy matches the application utility. CI now enforces `pnpm lint:ci` in addition to environment checks, TypeScript, tests, API compilation and web/iOS/Android exports.

This is the current-scope lint/session/runtime package, not an assertion that every issue from the earlier ten-defect security audit has been remediated. Dependencies, Expo/native identifiers, fixed ports, origin restrictions, hidden scrollbars and bottom navigation preferences remain unchanged.

## Actual schema and runtime actions

Trusted runtime configuration was refreshed through the current bound Host configuration operation. Fresh database connectivity succeeded; the signing secret and application identity matched the previous process, while its database setting was stale. No key or identity rotation occurred.

The prior three migration entries and their SQL hashes were verified before changing the schema. The installed standard Drizzle migrator applied only `0003_application_sessions`; the migration journal now has four entries. The new table's six columns, fingerprint primary key and exact user/application/expiry indexes were independently verified. Only the new table/indexes and migration journal entry were added; no existing social/user/live data was replaced, deleted, seeded or rewritten. The earlier journal state was retained as private operator metadata. No platform point-in-time backup/restore capability is claimed.

The stale API job was stopped after schema readiness. Its replacement watch wrapper hit the sandbox's file-watch limit and left an API child; only that confirmed orphan was retired. The API is now a Host-managed non-watching `tsx server/_core/index.ts` service on3000, using fresh settings. It needs an explicit targeted restart for subsequent server-source edits; the normal watched command remains available when watcher capacity is adequate.

The old Metro process ran out of Node heap and the first replacement exposed insufficient watcher capacity. Existing diagnostic servers each held roughly11,000watches and the Sandbox limit was31,835. The Sandbox allowance was raised to65,536 (not a user's local-computer change), and missing Metro was restored on8081 with one worker and a bounded4GBNodeheap. Both listeners and same-origin health/data now respond. No database reset, broad process kill, diagnostic-server replacement or detached unmanaged service was used. An existing UI import-cycle warning remains nonfatal; it is not claimed remediated.

## Applied-source validation

| Check                        | Actual result                                                                                                                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                   | Passed.                                                                                                                                                                                                                                                               |
| Full unit suite              | 11files /92tests passed with real credentials removed.                                                                                                                                                                                                                |
| ESLint                       | 116files scanned; zero errors /16warnings. The earlier private candidate scan had15warnings; these are distinct recorded scans.                                                                                                                                       |
| API build                    | Passed; reported124.5kBbundle.                                                                                                                                                                                                                                        |
| Workflow syntax              | actionlint passed.                                                                                                                                                                                                                                                    |
| Native/web source exports    | The exact reviewed frontend candidate previously passed iOS, Android and web export. Subsequent local support changes are package scripts, CI, README/TODO and skill sources, not mobile screen/media code. This is not a signed store build or physical-device test. |
| Read-only integration review | No source-level logout/schema/recovery/CI crosswiring regression found; documentation/count/status follow-ups were closed.                                                                                                                                            |

## Current read-only API verification

The utility derived all14current query procedures with no definition/access-classification drift. Actual current public Preview verification completed **nine positive query reads**, **two separate anonymous checks**, **zero failed checks**, and **five incomplete protected/context-dependent positive checks**. Existing public IDs were discovered through public lists only; no user/session/conversation/stream fixture or mutation was created for verification.

| Procedure            | Positive coverage                                                 |
| -------------------- | ----------------------------------------------------------------- |
| social.feed          | Passed                                                            |
| social.circles       | Passed                                                            |
| social.circle        | Passed using existing public circle                               |
| social.profiles      | Passed                                                            |
| social.profile       | Passed using existing public profile                              |
| social.members       | Passed using existing public circle                               |
| social.comments      | Passed using existing public post                                 |
| live.list            | Passed                                                            |
| system.health        | Passed; supplementary, not sole readiness proof                   |
| auth.me              | Authorized positive check incomplete; anonymous-null state passed |
| social.conversations | Authorized positive check incomplete; anonymous denial passed     |
| social.messages      | Incomplete without authorized conversation context                |
| live.signals         | Incomplete without authorized existing stream/viewer context      |
| live.chat            | Incomplete without authorized existing stream/viewer context      |

Strict full-coverage status is deliberately **incomplete**, not falsely successful. Protected/provider/cookie/native/multi-instance and active-live end-to-end validation still require real authorized context. Durable session code paths have synthetic regression coverage; no test session was minted in the shared database. Production-scale streaming, TURN and store submission remain outside this rollout.

## Source synchronization

The Manus-managed mobile repository remains canonical. The implementation was saved at `535aafd` and the identical source tree was pushed to the separate `mattwms76/Circles` repository at `52ee563f92fd435df639f360377a2f56e32defda`, using ordinary non-force commits. Both source copies and the copied skill utility bytes were verified equal. No repository ownership/visibility transition or store publication occurred.

All four jobs in [GitHub run39624391424](https://github.com/mattwms76/Circles/actions/runs/39624391424) are confirmed completed successfully: environment/TypeScript/ESLint/tests/API build, Android export, iOS export and web export. Five non-expired test/API/platform artifacts were verified. GitHub's aggregate run status was still `in_progress` at the last inspection despite every listed job having passed; no completed aggregate conclusion is claimed. The local watcher was stopped after recording all job results, leaving the GitHub run untouched.

The final follow-up commit restores prior TODO history and records these implementation results; it changes only Markdown and skips CI, rather than rerunning unchanged application code. Current app/health/data are available in Preview. Five protected/active-context query checks and real provider/native/multi-instance logout validation remain incomplete, and users with legacy sessions must sign in again.
