# Circles shared app / admin / database parity — 27 October 2026

## Current outcome

The app-side shared-permission and account-convergence repairs are implemented and all **838 unit/regression tests in 166 files** pass. The live database's selected app/auth/operations structural catalog matches the reviewed native migration contract. The separately approved admin security installation adds an exact verified security-policy extension, not unexplained structural drift.

This is **not yet a claim of 100% operational parity**. The admin-only Circle-directory discrepancy is now repaired in accepted source; final saved manifest re-pin, exact-source CI follow-up, unavailable canonical Git transport and independent account/provider/deployment activation gates remain open. The admin panel remains separate; consumer-private operations are intentionally not administrator features.

## App repairs

| Area | Implemented shared-behaviour repair | Evidence and boundary |
| --- | --- | --- |
| Live authority | Current approved circle role is checked under a parent-circle lock before host/viewer lease, stream, heartbeat, signal/chat/reaction work; generation-bearing media recovery is retained. | Dedicated source/unit tests and real PG17 removed-host create race. The full host/viewer/WebRTC interleaving matrix is not claimed. |
| Protected projections | Private feed final projection, comments, Circle Home, members, Activity labels/preferences/targets and onboarding hydration serialize with compatible parent-circle locks and current roles. | Real HTTP reader-first races observe actual PostgreSQL lock waits; removal then changes/denies fresh responses. |
| Membership paging | Exact optional PostgreSQL timestamp cursors preserve microsecond ordering and reject inconsistent display/exact cursor pairs. Existing clients retain the legacy cursor path. | Seven same-millisecond memberships traverse a limit-two HTTP page sequence exactly once; invalid cursor returns400. |
| Chat and editor | Explicit Chat denial masks cached transcript and stops read/send actions; editor saves/drafts are fenced by current source actor and committed component instance. | Permission/retry/actor tests and retained existing media/accessibility regressions. No real device timing is claimed. |
| Account transitions | Viewer-derived query cache and pending work are cleared/fenced across confirmed identity changes; current actor gates sidebar/profile state. | Actor-boundary unit tests; identity/session fixture seams remain disclosed. |
| Session identity | Authentication requires a currently present source actor rather than silently rehydrating a missing principal from a token; existing signed numeric email actor binding is preserved. | SDK regressions and existing real PostgreSQL identity/session drills. No provider credentials or live account were used. |

No application schema, native identity, asset, lockfile, prepared ordinary identity SQL or provider configuration changed. No production rows were read or written by this task's catalog verification or tests. A validated backend-only reload may be needed to load the repaired server source; it is separate from SQL installation or publication.

## Exact database comparison

The production comparison used bounded catalog queries in a read-only repeatable-read transaction. It selected metadata, not application records.

| App-only inventory | Verified value |
| --- | --- |
| Source tables / columns |27 /183 |
| Constraints / indexes / enums |95 /70 /8 |
| RLS enabled |27 /27 |
| FORCE RLS |5 tables, matching the source contract; not falsely reported as27 |
| Browser `anon` / `authenticated` app-schema USAGE |Denied |

The app/auth/operations combined comparison also matched197 columns,106 constraints,21 enum labels,75 indexes,29 table/RLS records, both helper routine definitions and the one noninternal trigger. These combined totals include helper schemas and must not be mislabeled as app-only counts.

### Approved security extension

The separate admin task installed only the owner-approved bundle `db5ba7c69e8b4e403359c8721c2aa7791e0b79c21245d82d2fae37855c5a44e5`, recorded as migration `20261027090357`. Its receipt reports eight FORCE-RLS admin tables and zero classifier issues across nine bounded catalog checks; installation does not supply an operator, password or runtime DSN.

Parent read-only checks independently confirmed the original27 app-runtime policies plus exactly69 approved additions:27 restrictive client-deny,28 admin-runtime SELECT,13 sealed executor ALL and one restrictive users UPDATE lock-only policy. Exact table/name/role/command/expression matching found **zero unexplained structural differences**. Raw old-baseline comparison is intentionally retained as `drift` because29 old app/auth/ops policies became98 after the approved installation; it is not relabeled as an unchanged baseline.

The ordinary app runtime has no admin schema USAGE. Optional ordinary `circles_identity` and feature reader remain absent/unactivated. The historical managed `supabase_admin` future-function default-permission warning remains a provider-review matter, not a current app-table exposure or a repaired finding.

## Complete capability review

Ten read-only domain reviews covered **84 unique app capabilities** against accepted admin implementation `ff85236289a3645b4aa00061444553eff7784eae`:13 identity,5 operations,11 content,8 private Activity,15 circles,12 live,4 moderation,5 onboarding,6 private messaging and5 profiles.

Role-aware source coverage includes approved projections/native counterparts and deliberate protected-consumer exclusions. DM transcripts, participant identity graphs, consumer sessions/preferences/onboarding state, provider-link mappings and live signaling do not become general admin access.

The original mismatch, **CIR-PRIV-001**, concerned three Circle-directory counterparts. It is repaired at admin source `c068d54c937cd86ee374343abf83eac7c155957d`: private directory rows and counts require a selected exact Circle and current scoped authority; unscoped calls exclude them even for source-platform administrators. The accepted receipt reports339 tests/45 files and64 actual disposable PostgreSQL assertions, including the private-name/count regression and preserved private-post exception. Parent source inspection confirmed the exact-scope-only predicate. Approved SQL and ordinary app private-circle join-request teasers remain unchanged; original review evidence remains historical, not overwritten.

The admin task reports its regenerated app1992245 contract covers84 IDs/70tRPC/14HTTP,66 modules (six changed hashes),15 unchanged SQL hashes and11 procedure declaration changes, with unchanged mapping dispositions and no blockers. It also reports19 tests over six app parity modules and340 admin tests/45 files passing. These are attributed admin-task results; its final saved manifest/receipt is still pending independent pin verification.

## Executed local tests

All15 final required local categories passed. Initial failed fixtures/test mocks and later successful corrections are retained separately rather than overwritten.

- Full unit/regression suite: **838 tests /166 files**; strict unused TypeScript, zero-warning lint, tracked-source formatting, auditor/template/API/workflow gates passed.
- Actual local PostgreSQL17 HTTP suites: Circle Home11, Activity12, Moderation7, parity authority11. Each runner reported no production access/writes and disposable fixture removal.
- Existing private identity DDL/RLS, real Drizzle allocation/link-race store and HTTP/session drills passed. HTTP provider responses and actor injection remain synthetic; the HTTP auth fixture's actor lookup adapter is not falsely presented as production `SDK.authenticateRequest` transport proof.
- Authority suite observes real `pg_stat_activity` lock waits, removal-wins live create with no lease/stream allocation, seven covered reader-first protected projections and exact member cursor traversal. Existing105-item Moments and105-item Saved traversals remain covered.

## Exact-source save and CI follow-up

Accepted app source is local canonical `51a61082c30a0bfc1b7679b27865a0bbeb23cd3a` and GitHub mirror `199224560485407047832dea0d0a873cbabcd78e`, both tree `26e8ea529beda7701ea9b8ccab84e1bf5b58f061`. Container run40479331685 passed. CI40479331760 passed unit/type/lint, Home/Activity/Moderation/authorityPG17 steps, then failed an existing-sign-in fixture assertion that stringified JavaScript Dates at second resolution after a5ms sleep. The raw identity-role/RLS drill passed first; later store assertions, HTTP/session, API build and platform bundles were not certified by that failed run. Preserve its failure receipt.

The narrow follow-up changes only the identity fixture, two new runner regressions and documentation. It seeds two deterministic timestamps five milliseconds apart within the same second, preserves PostgreSQL text precision and asserts database equality with the exact timestamp supplied to the real upsert. No sleep or weakened identity/role/rebinding assertion is used. Local evidence: five focused tests in two files pass; the repaired real Drizzle/storePG17 drill passes three separate executions; raw roles/RLS/rebinding drill passes; real HTTP/sessionPG17 fixture passes12 cases with mocked provider, cleanup and no production access/write. These runs are not added together as a new full-suite total. Successor source saving and automatic exact-source CI remain pending at this follow-up save.

After restricted read-only preflight, only the stale API was reloaded on3000. Metro8081 was preserved. Both listeners returned database-ready200, ordinary app email integration disabled and platform integration inactive/feature-readiness false. No SQL/provider/credential/opt-in/deployment/publication was performed by that reload or fixture repair.

## Remaining operational gates

1. Save the checked fixture-only successor and complete its automatic exact-source GitHub CI; original app source/container acceptance is recorded above. Canonical transport reports `bad band #78 / bad pack header` even after one trusted refresh/retry. Do not repeat failed transport, change remotes/providers, force-push or claim a recorded Manus checkpoint. Preserve local commits, normal authorized mirror and recovery bundle.
2. Verify the final saved admin manifest re-pin against accepted app1992245. The privacy implementation is accepted; the final re-pin receipt is not guessed from a pending task. A fixture/documentation successor changes no shared production contract.
3. Admin SQL is installed, but the console still lacks a dedicated configured credential/operator/provider/session/deployment proof. Owner-account provisioning and configuration are separate from installation.
4. Ordinary email identity migration0014, its controlled app opt-in and real email/account/native journeys remain separately gated. Google remains later; the optional five-field feature reader/app opt-in is not approved by the admin security installation.
5. Private media admission-to-delivered-byte behaviour is unchanged. Already delivered bytes cannot be recalled; in-flight storage delivery policy remains a separate bounded decision. No TURN/WebRTC device, native keyboard/assistive-tech or full operational revocation matrix is claimed.

No additional SQL, grant, provider, account, schedule, credential or publication action is authorized by this report. Complete machine-readable source and post-install receipts are preserved outside the repository under `/home/ubuntu/circles-full-parity-20261027/`.
