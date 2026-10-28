# Circles shared app / admin / database parity — 27 October 2026

## Final verified outcome

The shared source-contract review covers **84 unique capabilities across ten domains**, with **zero remaining confirmed shared-source discrepancies** after the accepted admin-only Circle-directory privacy correction. The selected native database structure matches its reviewed source contract, including the precisely classified, separately owner-approved admin security extension. The panel remains separate; consumer-private operations are not administrator features.

The latest tested app source passed **840 unit/regression tests across167 files**, all four GitHub CI jobs, isolated PostgreSQL17 feature/identity/session steps, API compilation and web/iOS/Android JavaScript exports. This is **not100% operational parity**: dedicated admin runtime/operator readiness, optional ordinary identity/reader activation, real accounts/devices/providers, deployment and the Manus canonical checkpoint remain unresolved.

## Accepted source and save identities

| Evidence | Exact identity |
| --- | --- |
| Original app parity implementation, local canonical | `51a61082c30a0bfc1b7679b27865a0bbeb23cd3a` |
| Equivalent GitHub production-contract pin | `199224560485407047832dea0d0a873cbabcd78e` |
| Original matching tree | `26e8ea529beda7701ea9b8ccab84e1bf5b58f061` |
| Fixture-only follow-up, local canonical | `d250954f631128ddc0d3e2b8d56478d032f77dc6` |
| Equivalent GitHub tested follow-up | `878b8af4ed917f9b19f6e967fe21b1e9eb65c259` |
| Follow-up matching tree | `827777a0a5f1d4a75d44bbf142f8acb4d519af74` |
| Admin private-directory source repair | `c068d54c937cd86ee374343abf83eac7c155957d` |
| Accepted admin source re-pin | `21d63d85cc9e1b05315084b0882d09b3499a40af` |
| Successful exact-source app CI | [40480138024](https://github.com/mattwms76/Circles/actions/runs/40480138024) |
| Original exact-source container verification | [40479331685](https://github.com/mattwms76/Circles/actions/runs/40479331685) |

The follow-up changed only the identity test runner, two runner regressions and documentation. All production modules, source SQL, dependencies, assets and native identifiers remain unchanged from the1992245 production-contract pin. This final report/backlog closure changes documentation only; its later commit does not alter CI-covered code. The container receipt is for1992245, not a separately executed successor-container run.

The canonical Manus remote was **not advanced**: fetch failed with `bad band #78 / bad pack header` after a trusted refresh and one retry. No further retry, remote/helper/ownership change, history rewrite or force-push was used. Checked local commits, the normal authorized GitHub mirror and separate recovery bundles preserve the work, but they are **not a recorded Manus checkpoint**. Managed transport assistance is routed to [Manus help](https://help.manus.im).

## App repairs and bounded proof

| Area | Implemented shared-behaviour repair | Evidence and boundary |
| --- | --- | --- |
| Live authority | Recheck current approved Circle role under compatible parent-circle/lease/stream locks for protected host/viewer work; retain generation-scoped media recovery. | Source/unit regressions and realPG17 removal-wins live-create race. Full host/viewer/WebRTC interleaving coverage is not claimed. |
| Protected projections | Serialize private feed/comments/Home/member/Activity projections with current authority and compatible parent locks; keep onboarding actor/profile freshness. | Real HTTP/Drizzle/PostgreSQL reader-first and removal-first fixtures; no production customer records. |
| Membership paging | Optional exact UTC microsecond cursor validates against the displayed timestamp and preserves legacy callers. | Seven same-millisecond memberships traverse limit-two HTTP pages exactly once; inconsistent cursor rejected400. |
| Chat/editor | Explicit permission loss masks cached transcript and disables actions; drafts/saves/completions are actor/component-bound. | Permission/retry/actor regressions, not physical-device timing proof. |
| Account transitions | Clear or fence viewer-derived cache, pending work, sidebar/profile state and editors across confirmed actor changes. | Account-boundary tests; no new account, role or provider activation. |
| Session identity | Require current source actor and retain signed numeric/provider-OpenID affinity rather than silently adopting a missing/recreated principal. | SDK/unit and existing real local identity/session evidence; fixture/provider seams remain explicit. |

## Complete capability and admin re-pin verification

The original ten-domain review covered identity13, operations5, content11, private Activity8, Circles15, live12, moderation4, onboarding5, private messaging6 and profiles5. The complete84-ID review and its original finding remain immutable in the separate evidence workspace.

**CIR-PRIV-001 is source-resolved.** Accepted admin source now uses `allowPrivateCircle = page.scope !== null` for shared Circle row/count bindings. Private directory metadata/search totals require selected exact-Circle authority; unscoped requests exclude them even for source-platform administrators. Scoped helper denial prevents projection/count. Membership-gated Home fields and the approved private-post/platform exception remain distinct, while ordinary app private-Circle join-request teasers are unchanged. The accepted admin receipt reports339 tests/45 files and64 actual local PostgreSQL assertions, including17 native cases and the directory/count/search/scope regression. These are attributed admin-task executions; the parent independently inspected the accepted correction.

Parent read-only verification of the saved admin re-pin independently confirmed:

- All **66 production-module hashes** and **15 source-SQL hashes** match the current app production files.
- All **84 unique capability IDs** match both the original domain review and84 mapping entries;70tRPC/14HTTP transports, kinds and authority classifications remain unchanged.
- Mapping bytes are unchanged: SHA256 `f74136113bff4c7f9551f664f8efa4b76751e21fb3ee334000e062207454fc02`.
- The actual declaration delta is **12: eleven live procedures plus social.membersPage**. An initial receipt said11; the admin task corrected that documentation-only count. It is not a semantic mismatch.
- Native source-table and approved-operation boundaries remain27 tables/eight native operations. No new SQL or privilege was needed for re-pinning.

The admin task separately reports340 full tests/45 files, types/build,19 focused accepted-app tests/six files and a narrow material-contract review with no blocker. Those are reported independent-task outcomes, not a second full-app rerun here. DM transcripts/participant graphs, consumer identity/session/preferences/onboarding state, provider links and live signaling remain protected exclusions rather than general console capabilities.

## Exact database structure and RLS comparison

Live verification used bounded catalog-only reads in a read-only transaction, not application records.

| App-only inventory | Verified value |
| --- | --- |
| Source tables / columns |27 /183 |
| Constraints / indexes / enums |95 /70 /8 |
| RLS enabled |27 /27 |
| FORCE RLS |5 tables, matching source; not27 |
| Browser anon/authenticated app-schema USAGE / CREATE |Denied |

Combined app/auth/operations metadata matched197 columns,106 constraints,21 enum labels,75 indexes,29 table/RLS records, both helper routines and the one noninternal trigger. Combined totals are not app-only counts.

The separate task installed only the exact owner-approved admin security bundle SHA256 `db5ba7c69e8b4e403359c8721c2aa7791e0b79c21245d82d2fae37855c5a44e5`, migration `20261027090357`. Its receipt reports eight FORCE-RLS admin tables and zero classifier issues across nine bounded checks. Installation does not supply an operator, password, dedicated runtime DSN or operational readiness.

Parent catalog classification confirmed original27 app-runtime policies plus exactly69 approved additions:27 restrictive client-deny,28 admin-runtime SELECT,13 sealed executor ALL and one restrictive users UPDATE lock-only policy. Exact table/name/role/command/expression comparison found **zero unexplained structural differences**. The raw pre-install comparator intentionally retains policy drift29→98; it is not relabeled as an unchanged baseline.

Ordinary app runtime has no admin-schema USAGE. Optional ordinary `circles_identity` migration0014 and the feature reader remain absent/unactivated. The provider-managed future-function default-permission warning remains a provider-review matter, not a current app-table exposure or a claimed repair.

## Tests and preserved CI failure

The original local implementation passed838 tests/166 files and15 required validation categories, including strict unused TypeScript, zero-warning lint, formatting, environment/auditor/API/workflow checks. Actual localPG17 suites passed Home11, Activity12, Moderation7 and parity authority11. Authority fixtures observed actual PostgreSQL lock waits, removal-wins live creation without allocation, seven reader-first protected projections, exact member paging and retained105-item Moments/105-item Saved continuation.

Initial CI40479331760 passed unit/type/lint and feature/authorityPG17 checks, then failed an existing-sign-in fixture that compared `String(Date)` after a5ms sleep. JavaScript Date strings discard milliseconds; later HTTP/API/bundle steps were skipped in that failed run. Its log and failure receipt are retained.

The fixture-only repair seeds two fixed timestamps five milliseconds apart within the same second, compares PostgreSQL text precision and asserts database equality with the exact supplied timestamp through the real upsert. No wall-clock sleep or weakened identity/role/rebinding assertion remains. Local focused evidence: five tests/two files, types/lint/format, three successful real-storePG17 executions, raw role/RLS/rebinding drill and12 actual HTTP/sessionPG17 cases with mocked provider and complete cleanup. Overlapping runs are not summed.

Successful successor CI40480138024 is pinned to878b8af. Downloaded JUnit independently confirms **840 tests /167 files /zero failures /zero errors /zero skipped cases**. All four jobs and every recorded step succeeded: full checks/API plus web/iOS/Android JavaScript bundles, including featurePG17 and identity roles/store/HTTP/session drills. JavaScript exports are not signed builds or native-device validation. Mocked provider responses and fixture actor lookup are not real-account/provider or production SDK HTTP authentication proof.

## Runtime and remaining gates

After a restricted read-only preflight, only the stale API was reloaded on3000 to load repaired server source; Metro8081 was preserved. Both listeners returned database-ready200. Ordinary app email integration remains disabled; platform integration remains inactive with feature-readiness false. The fixture follow-up and documentation closure restarted neither service.

Remaining outcomes require separate authorization and evidence:

1. Restore supported canonical Manus Git transport and record the actual checkpoint, preserving local/mirror histories.
2. Configure the dedicated admin runtime credential and first owner/operator, then prove real session/MFA/provider/resource checks and the two-application runtime boundary.
3. Separately approve/install ordinary identity0014 and controlled email app opt-in, then validate real email/account/device journeys. Google remains later.
4. Separately provision the optional five-field feature reader and approve opted-in app enforcement; installed admin security SQL alone does not activate feature controls.
5. Perform native/device, assistive-tech, two-party live/WebRTC/TURN and approved deployment checks. Private media delivered bytes cannot be recalled; in-flight delivery policy and full operational revocation coverage remain bounded gaps.

No additional SQL, grant, production row, account, provider, credential, schedule, backup, opt-in, deployment or publication change was made by this closure. Auto-publication remains disabled. Private source/catalog/CI receipts and recovery bundles remain outside Git under `/home/ubuntu/circles-full-parity-20261027/`.
