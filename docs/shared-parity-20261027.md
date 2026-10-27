# Circles shared app / admin / database parity — 27 October 2026

## Current outcome

The app-side shared-permission and account-convergence repairs are implemented and all **838 unit/regression tests in 166 files** pass. The live database's selected app/auth/operations structural catalog matches the reviewed native migration contract. The separately approved admin security installation adds an exact verified security-policy extension, not unexplained structural drift.

This is **not yet a claim of 100% operational parity**. One admin-only Circle-directory privacy discrepancy, exact admin manifest re-pinning, unavailable canonical Git transport and independent account/provider/deployment activation gates remain open at this report's initial save. The admin panel remains separate; consumer-private operations are intentionally not administrator features.

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

One current mismatch, **CIR-PRIV-001**, concerns three Circle-directory counterparts. The accepted admin policy permits public directory fields and exact-current-Circle private metadata; its implementation additionally admits global private metadata for a source-platform-admin reader. The admin task confirmed and is repairing only that broad directory/count admission, without changing the approved SQL or narrowing the app's deliberate private-circle join-request teasers. Final source acceptance and re-pinning are pending; original review evidence remains intact.

## Executed local tests

All15 final required local categories passed. Initial failed fixtures/test mocks and later successful corrections are retained separately rather than overwritten.

- Full unit/regression suite: **838 tests /166 files**; strict unused TypeScript, zero-warning lint, tracked-source formatting, auditor/template/API/workflow gates passed.
- Actual local PostgreSQL17 HTTP suites: Circle Home11, Activity12, Moderation7, parity authority11. Each runner reported no production access/writes and disposable fixture removal.
- Existing private identity DDL/RLS, real Drizzle allocation/link-race store and HTTP/session drills passed. HTTP provider responses and actor injection remain synthetic; the HTTP auth fixture's actor lookup adapter is not falsely presented as production `SDK.authenticateRequest` transport proof.
- Authority suite observes real `pg_stat_activity` lock waits, removal-wins live create with no lease/stream allocation, seven covered reader-first protected projections and exact member cursor traversal. Existing105-item Moments and105-item Saved traversals remain covered.

## Remaining operational gates

1. Save accepted app source and complete exact-source GitHub CI/container; canonical transport currently reports `bad band #78 / bad pack header` even after one trusted refresh/retry. Do not change remotes/providers, force-push or claim a recorded Manus checkpoint. Preserve the tested local commit and normal authorized mirror if transport remains unavailable.
2. Accept the admin-only directory correction and regenerate its manifest from the newly accepted app SHA rather than a WIP hash or old pin.
3. Admin SQL is installed, but the console still lacks a dedicated configured credential/operator/provider/session/deployment proof. Owner-account provisioning and configuration are separate from installation.
4. Ordinary email identity migration0014, its controlled app opt-in and real email/account/native journeys remain separately gated. Google remains later; the optional five-field feature reader/app opt-in is not approved by the admin security installation.
5. Private media admission-to-delivered-byte behaviour is unchanged. Already delivered bytes cannot be recalled; in-flight storage delivery policy remains a separate bounded decision. No TURN/WebRTC device, native keyboard/assistive-tech or full operational revocation matrix is claimed.

No additional SQL, grant, provider, account, schedule, credential or publication action is authorized by this report. Complete machine-readable source and post-install receipts are preserved outside the repository under `/home/ubuntu/circles-full-parity-20261027/`.
