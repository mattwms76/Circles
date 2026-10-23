# Circles — next development decisions

**Reviewed:** 23 October 2026, after Activity Inbox v1. **Status:** selected priorities, not implemented by this review.

## Decision and recommended sequence

The next product feature is **Moderator Report Workspace v1**. The next UI change set is **Batch 1A — shared accessibility, media resilience and contrast**. Complete that bounded UI foundation first, then build the moderation workspace. Queue header reflow/safe areas as a separate Batch 1B rather than coupling it to the primitive changes. A community prompt ritual follows these foundations; native push and a full events platform are not next-batch features.

Circle-first onboarding, Circle Home v1 and Activity Inbox with per-circle preferences are already implemented; do not rebuild them. Existing app source, tests, migrations, CI, reusable skills and documentation were clean and synchronized to both app repositories at this review. The separate encrypted-backup source was also synchronized and its repository remains private. This review publishes only sanitized planning/audit narratives, not secrets, recovery identities, raw logs, screenshots containing user content, decrypted backups or generated exports.

## 1. Next feature: Moderator Report Workspace v1

### Why now

Members can report a post, but current moderators have no report queue, resolution status or case history. Report capture is currently an upsert per reporter/post with a fixed UI reason (`drizzle/schema.ts:379–400`, `server/social-service.ts:2042–2055`, `components/post-card.tsx:461–475`). Existing Circle Manage can remove loaded posts but is not a report workflow (`app/circle/[id].tsx:759–780`). Turning these existing safety signals into an actionable review path is more valuable now than adding another engagement surface after onboarding/Home/Updates.

### Bounded product scope

| Area | Selected v1 outcome |
|---|---|
| Entry and queue | Add Reports under the existing circle Manage area. List only reports concerning that circle's posts, with bounded keyset pagination and open/resolved filters. Global/non-circle reports remain outside this workspace. |
| Case detail | Show current accessible target, aggregate report count/reasons and minimal case history. Do not expose reporter identity in any queue/detail/history response. Treat removed/unavailable targets safely. |
| Resolution | Provide explicit Keep and Remove outcomes with a short moderator-only resolution note. Serialize/idempotently resolve against current case state and recheck current circle role and resource authority in the transaction. Use existing authorized post-deletion behavior for removal. |
| Durable evidence | Keep case outcome and minimal actor/action/time history after removal without retaining copies of removed post bodies/media or reporter identity snapshots. Define a controlled mapping for eligible pre-existing reports rather than silently ignoring them. |
| UI safety | Fresh account/circle-scoped reads, pending/disabled states, confirmation for removal, safe retry, empty/error handling and no cross-account stale cache disclosure. |

The reviewer identity comes from the session, never a supplied role or user ID. Every read and resolution requires the current owner/moderator of that exact circle; guests, pending/ordinary members and foreign-circle moderators receive no access. Report authors/subjects do not receive moderator notes or reporter identities.

**Policy to make explicit in the implementation plan:** the recommended default is to prevent a reviewer from resolving a case concerning their own post. If there is no eligible non-subject reviewer, keep the case open; do not invent platform-staff authority. Also define what happens to later reports on a resolved case. For a bounded v1, Keep/Remove are final with no automatic reopening; later reports must not silently erase prior history. These choices are recommendations, not already implemented behavior.

Do not add automatic enforcement/AI decisions, suspensions, cross-circle bulk actions, staff/global trust tooling, evidence exports, appeals, slow mode, reporter/author notifications or native push in this slice. Do not conflate post deletion with physical storage-object erasure: provider-object deletion remains a separate open limitation.

### Required proof when implemented

Use the existing disposable localhost PostgreSQL17 + HTTP pattern with synthetic identities and mandatory teardown. Cover per-circle/role denial, reporter-identity omission, subject-reviewer conflict, revoked authority, duplicate report retries, concurrent Keep/Remove, safe unavailable targets, preserved minimal history and account-switch cache refusal. Align any additive private tables with exact readiness, security/health/recovery and backup contracts. No production test fixtures, genuine OAuth/native-device proof or publication is implied by those tests.

## 2. Next UI batch: 1A — shared primitive integrity

The [archived 48-finding design audit](audits/design-audit-20261023.md) is the baseline. Its Activity Inbox exclusion and old line numbers remain historical; a focused current read confirms the shared primitive mechanisms below. This is not a fresh rendered all-screen audit.

| Order | Audit IDs | Selected change | Scope and important limits |
|---:|---|---|---|
| 1 | I-01 | Preserve the shared Button's accessible name while its spinner is visible; expose busy/disabled state and continue blocking presses while loading. | `components/circles-ui.tsx`. Do not alter mutation semantics, callbacks, titles or minimum control size. |
| 2 | I-02 | Give shared Input a programmatic name, supporting an explicit override and otherwise its visible label/placeholder. | Preserve visible text, all existing input behavior and cross-platform support; a sibling visual label is not sufficient. |
| 3 | I-03 | Add a generic failed-media fallback and failed-avatar initials fallback; preserve caller error callbacks. | `components/media-image.tsx` and shared Avatar. Reset state with source/account identity. Protected native images must remain idle while the correct bearer is pending; never substitute an unauthenticated URL or reuse another account's source/header/error state. |
| 4 | I-04, I-10 | Introduce compliant secondary-text semantics and use the same compliant token for inactive tab labels and icons. | Shared palette and `app/(tabs)/_layout.tsx`; check actual foreground/background pairs, not one isolated hex value. |
| 5 | I-35 — **partial coverage only** | Correct shared primary-action fill/text/spinner contrast using semantic accessible tokens. | Preserve decorative/brand coral and the warm editorial identity. This does not automatically fix every Theme Lab, Messages or Live badge/status combination. Enumerate untouched consumers for later verification. |

**Primary touchpoints:** `components/circles-ui.tsx:16–26,98–203,320–363`; `components/media-image.tsx:24–89`; `app/(tabs)/_layout.tsx:68–82`. Source references are for selection, not immutable post-change line numbers.

Target at least **4.5:1 for normal text** on every intended surface. Calculate/measure selected pairs during implementation rather than treating a proposed palette as verified. Preserve the signature brand color in artwork/decorative uses; accessible action/foreground variants can differ without changing the brand.

This batch selects six issue areas; it is not six completed fixes. I-35 remains partially open even if its shared-control portion passes. Post media descriptions (I-11), attachment labels (I-26), role-specific mutation behavior and individual navigation/hit-area fixes are not silently included.

### Proof needed for Batch 1A

Verify stable Button names, busy/disabled semantics and blocked loading presses; Input explicit/fallback labels; public media failure and avatar fallback; protected-media token-pending behavior; same-URI account switches without stale source/error/header reuse; and all changed contrast pairs. Use deterministic component/pure-helper regressions where available and accessibility-tree/screen-reader checks where actually supported. Run type/lint and affected tests, then exact-source CI. Clearly keep real iOS/Android assistive-tech, authenticated rendered and hardware checks open when unavailable.

## 3. Immediately following UI batch: 1B — header and safe areas

Queue **I-05, I-06, I-07** separately. Replace fixed AppShell header height with a minimum-height/reflow strategy and apply top/left/right physical safe-area insets once without doubling gutters. The current narrow header has Search and Messages for guests, plus Activity when signed in. Treat those two/three controls as one nonwrapping cluster; when space is insufficient, move the whole cluster to another row. Do not hide Activity, shrink hit targets, disable text scaling, add horizontal scrolling or change routes/tab composition.

Validate 320/360/390 widths, enlarged text, signed-out and signed-in clusters, asymmetric landscape insets and wide-tablet layouts. These are future verification requirements, not observed native passes. Custom Live bottom clearance (I-42) and modal containment (I-43) stay route-specific. Sidebar Join pending behavior (I-09) is also separate despite being in the same file.

## 4. Remainder of the design queue

| After 1A/1B | Focus |
|---|---|
| Navigation and mutation safety | Follow/sidebar Join pending behavior, named image/card destinations, 44-point hit targets, conversation semantics, blank-send behavior, Circle Back and person-profile return navigation; the observed Home Like hit area remains included in this later work. |
| Responsive data/layout policy | API-aligned search limits, server-side joined-circle filtering, bounded long labels, responsive composer/profile/filter/hero rows and compact-height OAuth recovery. |
| Route-local semantics/media | Post descriptions, attachment labels, route-specific status/disclosure contrast and custom Live safe-area/modal handling. |
| Theme Lab | Genuine Dark preview or an honest removal of the choice, selection semantics and local target/inset corrections. Do not let a developer utility displace member-facing fixes. |

No design finding is closed by this selection. The archive retains 48 deduplicated findings/conditional risks; the initial rendering was signed-out at 1280×1100, not narrow/native/authenticated coverage. Existing hidden scrollbars, absence of a Chats bottom tab, deliberate cover crops and the editorial identity remain intentional.

## 5. Separate launch/security/operational gates

These are not product-feature substitutes and remain open: four dependency advisory exceptions; exposed-token revocation/coordinated database-credential rotation and owner recovery-key custody; future provider-admin routine privilege/default/gateway checks; unsupported provider object deletion and real app-media/key recovery; approved real-account/custom native-device E2E, signing/publication; deferred coturn infrastructure/real relay proof; and actual scheduled/30-day backup observations when due. Source/CI/container/manual-backup evidence does not close those gates.

## Change and Git scope of this review

Only this decision document, the sanitized historical audit narrative and backlog status are changed. No app feature/UI fix, migration, production row action, provider/secret update, listener restart or publication is performed. Existing implementation CI/container evidence remains the prior successful exact-source runs; documentation-only saving does not claim another full test run. Preserve both repository histories, keep the mobile canonical source Manus-managed, and use the separate GitHub code copy without a force push.
