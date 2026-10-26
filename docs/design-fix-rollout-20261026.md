# Circles: 31 design-finding repairs

**Date:** 26 October 2026. **Scope:** approved source fixes plus the requested live-indicator and email-identity inspections. No production SQL, account data, provider configuration, runtime opt-in or publication.

## Status

All **31 deduplicated audit findings have source-level repairs**. D26-21 is the documented alias of D26-07, not an additional defect. The original audit classified20 confirmed-source and11 conditional-source findings; implementing the latter does not certify their native rendering or physical accessibility behavior. Local integrated checks pass. Canonical/GitHub saving and exact-source remote CI are being recorded separately below when observed.

## Complete repair register

| ID | Implemented repair | Principal source / regression |
| --- | --- | --- |
| D26-01 | Meaningful muted copy uses measured secondary text across light surfaces. | Shared primitives and route consumers; `design31-primitives` |
| D26-02 | Active navigation, action/unread text and own-message bubbles use compliant semantic action/foreground tokens; decorative branding remains. | Shell, Activity, messaging; `design31-shell`, `design31-activity` |
| D26-03 | Avatar fallback initials and remaining Circle/Moderation/onboarding-entry meaningful green copy use secondary/action colors. | Avatar, Circle, Moderator, onboarding entry; primitive/integration checks |
| D26-04 | Default and explicit editor placeholders use compliant secondary color; Input forwards the typed native ref. | Input and editor consumers; primitives and retained Batch1A tests |
| D26-05 | A boundary-aware section resolver exposes current rail sections, including nested chat/live/account routes. | `app-navigation-state`, AppShell; shell tests |
| D26-06 | Named semantic composite controls and declared44/48-point minima; duplicate sidebar image/name launches consolidated. | Shell, Circle, Discover, onboarding; module tests |
| D26-07 | Shared StatusMessage supplies polite progress/success and assertive errors; typed notification tones, safe error copy and visual-only Live echo prevent duplicate adapter announcements. | Status helper/provider/consumers; status, notice-integration and async tests |
| D26-08 | Sidebar has loading, retryable error, empty and settled content branches. | AppShell; shell tests |
| D26-09 | Guest authentication has one outer dialog card/Close control; embedded form is frameless, standalone connection form keeps its frame. | Provider/form; auth-surface tests |
| D26-10 | Email Next focuses the actual forwarded password input; Done retains scoped submission. | Input/form; primitives/auth tests and offline source renderer |
| D26-11 | Opening a direct conversation is actor/person/instance scoped and single-flight, with visible pending/conflict state. | Profile; profile tests |
| D26-12 | Messages and preference screens distinguish checking, retryable auth error and true guest. | Messages/Activity; messaging/activity tests |
| D26-13 | Protected-media authorization waiting paints neutral/caller placeholders, not stale protected content. | MediaImage/PostCard; media/messaging tests |
| D26-14 | Profile/chat/post author names may wrap; Moderator detail additionally discloses the complete reported author. | Profile/chat/post/moderation; module tests |
| D26-15 | The complete guest dialog owns safe-area and keyboard scrolling, avoiding nested framing. | Provider/form; auth tests and bounded320×480 standalone form render |
| D26-16 | A retained Create recipient is named only after matching current-account membership resolution; resolving/error/retry/unavailable states block ambiguous submission. | Create/helper; create tests |
| D26-17 | Composer owns asymmetric lateral safe-area padding once. | Create/helper; inset tests |
| D26-18 | Local Theme Lab radio boundary tokens exceed3:1; native checked/selected state is preserved and direct web `aria-checked` updates correctly. | Theme/helper; theme tests and actual offline light/dark toggle |
| D26-19 | Preparation exposes explained Leave camera setup state; cancellation authority comes only from the current authenticated host join lease/generation. | Live route/adapters/helper; live-UI and retained lifecycle tests |
| D26-20 | Live status text has an opaque white backplate and shared status semantics. | Native/web/fallback media adapters; live-UI tests |
| D26-22 | Circle Members/Manage lists have explicit loading/error-retry/empty/content states. | Circle/helper; circle tests |
| D26-23 | Target-specific Circle management flights show pending labels, disable conflicts and reject stale actor/circle/generation completion. | Circle/helper; circle tests |
| D26-24 | Recommendation Join controls retain concise visible copy and expose the actual circle name. | Onboarding; onboarding tests |
| D26-25 | Long titles shrink/wrap; category chips have bounded layout plus the complete accessible category name. | Onboarding; onboarding tests |
| D26-26 | Photo/video failures have accurate unavailable labels and bounded explicit retry, preserving protected-media authority. | MediaImage/PostCard; messaging/media tests |
| D26-27 | Wide side rails reserve bottom system/gesture insets. | AppShell/layout helpers; shell tests |
| D26-28 | Activity actions expose bounded update-derived labels, unread context and busy state. | Activity surfaces; activity tests |
| D26-29 | Post options have a noninteractive modal root and separate guarded backdrop/action sheet. | PostCard; messaging/media tests |
| D26-30 | Root notice is suppressed on the OAuth callback while local recovery owns the status surface. | Provider/callback; auth-surface and async-status tests |
| D26-31 | Discover makes its existing route-wide Follow flight visible, busy and conflict-disabled with person-specific explanation. | Discover; discover tests |
| D26-32 | Own-profile actions reflow at compact/scaled widths; names are not capped to two lines and connection/return authority remains. | Profile; profile tests |

The callback suppression ambiguity in the preliminary reducer was an attribution error: the actual integration table and executable auth test already agree on the implemented suppression. No authentication choreography was changed to resolve that editorial discrepancy.

## Observed validation

- **736 unit/regression tests across149 files passed**, plus12 targeted final tests rechecked the last radio-state assertions and retained primitive/status contracts.
- Strict TypeScript with unused-symbol checks, zero-warning ESLint, tracked-source Prettier, database-auditor tests, environment-template check, API build and workflow lint passed.
- Fresh disposable PostgreSQL17 HTTP suites passed: **Circle Home11, Activity12, Moderation7**. Fixtures were removed, and no production credentials/rows were used.
- Direct identity-DDL and real-store mapping drills passed. The separate actual HTTP/store/durable-session drill passed **12 cases**, using an **in-process provider mock** and a disclosed fixture actor-lookup adapter—not a real provider or full production `SDKServer.authenticateRequest` database journey. HTTP servers, pools and PostgreSQL fixtures were closed/removed.
- **28 offline browser checks passed, zero failed/skipped**, executing actual Button/Input/T/Avatar, StatusMessage, Theme Lab and EmailAuthForm source with disclosed media/icon/inset/client fixture seams. No HTTP requests were observed. Actual Email Enter→Password focus, computed text/placeholder contrast, named controls, updated radio checked state and horizontal containment passed. This is not an all-screen or native-device journey.
- Original failed runs remain private. Integration repairs removed one unused error argument, adapted four obsolete source/mock assertions without dropping their behavior, and added the required `--import tsx` loader to private auth-drill invocation. No production module-resolution workaround was added.

### Rendered limits still open

The offline injected2× text-pressure fixture has no document horizontal overflow but truncates a long single-line placeholder and allows multiline placeholder overflow/scrolling. Field labels remain exposed. This is documented pressure behavior, not proof of native dynamic-type sizing. Native screen readers, real keyboard/IME and font scale, notched landscape/gesture insets, modal propagation, actual protected media, bright live-video compositing, camera/relay/host-viewer lifecycle and approved real accounts remain separate validation gates. Saving or JavaScript export is not signed-device validation or publication.

## Requested live-indicator inspection

The independent live layer preserves the story frame and its4-point inset, remains pointer-inert and excluded from focus, and conservatively stops pulse work for reduced motion/backgrounding. Source uses exact viewer authority, ready/fresh45-second leases, local expiry,64-ID request batches and a512-registration cap. The feature has **18 dedicated deterministic/mock/source tests in4 files**, all included in the passing current suite. There are13 identity-aware render sites; avatars without an authoritative person ID deliberately do not infer identity from names/images. No new indicator defect was found; real query-observer/account-switch, motion/device and live-broadcast proof is still absent. Historical672 whole-app tests are not18-feature-test coverage, and historical failed-format evidence is retained rather than erased; current formatting passes.

## Requested private email-identity inspection

Prepared migration `operations/migrations/0014_circles_email_identity.sql` is unchanged: SHA-256 `3aa2fc177771c1851070f227606520f8c4ce4bb63641cd690b978a1b7d7e2e50`. It creates only the private one-to-one UUID→numeric-user map, with FK cascade, postgres ownership, enabled/forced RLS and runtime-only SELECT/INSERT. Client roles and runtime UPDATE/DELETE/TRUNCATE are denied. Existing-source connection requires both the current authenticated actor and provider-verified identity; there is no email-only auto-link or role promotion. New own durable sessions bind the signed numeric actor, and existing logout/native drain protections remain.

Fresh catalog-only inspection found no identity schema/table or recorded0014 installation. Both API3000 and same-origin Metro8081 remain ready; email status is **disabled/not ready**. That deployment gate is **not evidence that provider email is disabled**. This task did not apply SQL, activate the email/Google/admin/feature reader, sign in a real account, rotate credentials, restart healthy services or publish. The private backup's28/29 contract was inspected, not changed here. Live installation and opt-in require separate approval and verification.
