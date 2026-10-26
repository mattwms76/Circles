# Circles design audit — consolidated source-only review

**Audit date:** 26 October 2026

**Scope:** 19 route reviews plus the shared-shell/UI reviewer; supplied results only.

**Baseline:** canonical SHA `1a865eceac0f5a349fa78c7454ba5fbdcaafe7ea`; GitHub mirror `d96a843`; code CI `40324439344`.

**Source snapshot:** `/home/ubuntu/circles-design-audit-source-20261026` (source-only baseline; app source commit `1e0ce1e9c89ab55df7c304196e9262f271cb3a67`).

## Executive assessment

This is a consolidated **static/source review**, not a browser, native-device, accessibility-tree, or production certification. The supplied evidence contains **31 deduplicated findings**: **23 medium** and **8 low**. By evidence kind, **20 are confirmed-source** (a source-level condition is directly present), **11 are conditional-source** (the triggering layout, data, media, renderer, or assistive-technology result remains unrendered), and **0 are rendered findings**. Coverage gaps are not counted as defects.

The primary systemic priorities are:

1. Replace the shared low-contrast semantic uses of `C.muted`, `C.green`, and functional `C.coral`, including active navigation, unread text, message bubbles, metadata, helpers, and placeholder text.
2. Complete the shared AppShell navigation contract: current-section state, route mapping for child screens, named/button semantics for Live and sidebar route targets, and explicit sidebar query states.
3. Add a deliberate, platform-appropriate announcement contract for global and local asynchronous outcomes without moving focus.
4. Resolve guest email-dialog composition and keyboard traversal: one dialog frame/Close control and a real email-to-password Next handoff.
5. Add route-local resilience states: Discover follow flight behavior, Circle Members/Manage lists and mutations, Create preselected-recipient state, failed-media state, and Activity row labels.

The supplied collection reported **Failures: `[]`**. No collection failure is being hidden or reclassified as a design finding.

## Evidence boundaries and non-defect separation

No supplied result includes a rendered browser or native screen, screenshot, physical target measurement, accessibility tree/screen-reader transcript, font-scale/device matrix, real authenticated account, provider call, production data, media decode/failure, or real-time transition. Therefore this review does **not** claim actual wrap, clipping, safe-area overlap, keyboard behavior, focus trapping/return, focus visibility, physical CSS/native target geometry, spoken output, video compositing, or motion behavior.

The following are expressly separate from UI defects and are **not** counted:

- Email identity SQL, provider setup, app opt-in, runtime readiness, accounts/passwords, and production data. The baseline remains `email_runtime_enabled=false`; disabled/not-ready email is a deployment gate.
- Future Google sign-in availability, administrator/moderator authorization and operational decisions, production SQL, services, credentials, runtime changes, publication status, and any unpublished state.
- The stated 512-avatar cap, source-cropped imagery, intentional hidden scrollbars, absent Chats tab, and decorative warm brand coral **when it does not carry information or control state**.
- The decorative, pointer-inert LIVE avatar ring. Its source safeguards (story inset, accessibility exclusion, account freshness/expiry, foreground/reduced-motion handling) remain positive source coverage; lack of a separately spoken LIVE badge is not counted as a focus regression.
- No claim is made that all historical 48 issues are fixed, or that the application has blanket WCAG/native conformance.

The contrast target applied here is 4.5:1 for ordinary information text; the large-text, inactive, decorative, and logotype exceptions were not used to excuse functional text. The application’s 44-point convention is retained as a source-level design convention, not proof of physical target compliance or a statement that AA requires 44 CSS pixels. See [text contrast][1], [AA target size][2], [enhanced target size][3] and [motion preferences][4].

## Finding inventory and counts

### Counts

- **All deduplicated findings:** 31
- **Severity:** 23 medium; 8 low; 0 high
- **Kind:** 20 confirmed-source; 11 conditional-source; 0 rendered
- **Cross-count:** confirmed-source = 16 medium + 4 low; conditional-source = 7 medium + 4 low; rendered = 0

### Evidence-kind legend

- **Confirmed-source:** the cited static source directly establishes the condition. It is not proof of a rendered user impact.
- **Conditional-source:** the source exposes a credible condition, but the outcome depends on data, viewport, device, renderer, timing, media, or assistive technology and must be validated in rendering.
- **Rendered:** none supplied. This audit never promotes a source inference into a rendered observation.

## Prioritized deduplicated findings

### Priority 1 — shared design-token and information-contrast remediation

**D26-01 — Meaningful `C.muted` content misses normal-text contrast**

**Medium · confirmed-source · affected coverage:** Home, Discover, Circles, Messages, Profile, Email connection, Chat, Circle, Create, Moderation, Onboarding, Person, Activity detail, Activity Inbox/Preferences, and shared shell/form primitives.

`C.muted` (`#888B84`) is measured at **3.26:1 on `C.bg` `#F9F8F5`**, **3.46:1 on white `#FFFFFF`**, **3.07:1 on the search surface**, **3.14:1 on unavailable-item `#F4F4F0`**, and **2.94:1 on sage `#E9EEE5`** where cited. It is used at ordinary sizes for metadata, bios, helpers, loading/availability text, search/sidebar information, timestamps, role/context text, and instructions—not only inactive decoration. Use `C.secondary` (`#4D5948`) or measured semantic replacements for normal information; its supplied checks are **6.97:1 on `C.bg`**, **7.40:1 on white**, **6.66:1 on `C.soft`**, and **6.28:1 on sage**.

**Exact source refs:** `components/circles-ui.tsx:21-35,49-61,157-165,180-184,527-533`; `app/(tabs)/discover.tsx:67-78,401-408,542-544`; `app/(tabs)/circles.tsx:46,217-226,273-282`; `app/(tabs)/messages.tsx:58-60,188-201`; `components/profile-screen.tsx:450-467`; `components/email-auth-form.tsx:398-448,419-432,426-447,650-652`; `app/chat/[id].tsx:383-392,520-523,569-584,593-613`; `app/circle/[id].tsx:423-442,625-655`; `components/circle-home-panel.tsx:80-118`; `components/post-card.tsx:325-337,486-501,612-629`; `app/create.tsx:580,651,693,713,734,792-806,820-827,862`; `components/moderation-workspace.tsx:799-862,873-939`; `app/onboarding.tsx:45-48,494-500,525-528,543-546,592-594,640-642,656-663`; `app/updates/[id].tsx:169-175`; `app/updates/index.tsx:413,448-450,485-490`; `components/activity-preferences.tsx:365,381-397`; `components/app-shell.tsx:152-166,530-534,578-580`.

**D26-02 — Functional coral carries normal text/state below target**

**Medium · confirmed-source · affected coverage:** Home, Circles, Messages, Profile, Chat, Live directory, Activity detail, Activity Inbox/Preferences, Onboarding, Create, and shared compact/wide navigation and activity badges.

`C.coral` (`#ED604A`) is **3.10:1 on `C.bg`**, **2.97:1 on `C.soft` `#FFF0EB`**, and white text on coral is **3.30:1**. It is used for selected navigation labels/icons/markers, unread count text, the sender message bubble, `Mark read`, selected-media/action text, and text-only actions. These carry current location, unread, or action meaning, so decorative-brand exceptions do not apply. Use a measured active/action token such as `C.action` (`#A53728`): supplied checks are **6.22:1 on `C.bg`**, **5.95:1 on `C.soft`**, and **6.61:1 with white text**.

**Exact source refs:** `app/(tabs)/_layout.tsx:41-87`; `components/app-shell.tsx:256-301,591-599`; `components/activity-badge.tsx:37-53,68-86`; `app/chat/[id].tsx:525-535,557-565`; `app/(tabs)/index.tsx:65-69`; `app/create.tsx:792-806,820-827`; `app/updates/index.tsx:42-55,306-317,414-425,458-466`; `app/updates/[id].tsx:169-175`; `components/circles-ui.tsx:21-36`; `lib/ui-accessibility.ts:1-46,71-77`.

**D26-03 — Green semantic text and avatar initials also miss ordinary-text target**

**Medium · confirmed-source · affected coverage:** Discover, Circles, Circle detail, Create, Moderation, Onboarding, Activity Inbox/Preferences, and shared avatar fallback.

`C.green` (`#718569`) is **3.39:1 on `C.sage` `#E9EEE5`**, **3.76:1 on `C.bg`**, and **3.99:1 on white**. It is used for avatar fallback initials, live/help/status copy, preference success, member-role labels, and active links. The unrelated community disclosure color `#A0A497` is **2.40:1 on `C.bg`**. Keep low-contrast green for genuinely nonessential decoration only; use `C.secondary` or a tested dark semantic role/status token for meaningful copy and initials.

**Exact source refs:** `components/circles-ui.tsx:140-185,21-35`; `app/(tabs)/discover.tsx:67-78`; `app/circle/[id].tsx:423-442,625-655`; `components/activity-preferences.tsx:365,381-397`; `app/create.tsx:792-806`; `app/onboarding.tsx:45-48,494-500,525-528`; `components/moderation-workspace.tsx:799-862,873-939`; `components/app-shell.tsx:647-660`; `lib/ui-accessibility.ts:49-77`.

**D26-04 — Shared Input’s visible placeholder default is too faint**

**Low · confirmed-source · affected coverage:** Create and all shared Input consumers, including guest email sign-in.

The default `placeholderTextColor` `#A0A299` on `C.bg` is **2.43:1**. Since callers may omit a visible label, a visible placeholder can carry operational input purpose. Set an at-least-4.5:1 default or require an explicit compliant placeholder token while retaining visible labels and accessibility-label fallback.

**Exact source refs:** `components/circles-ui.tsx:389-447,424-447`; `components/email-auth-form.tsx:530-544`; `app/create.tsx:580,651,693,713,734`.

### Priority 2 — shared navigation, control semantics, and state feedback

**D26-05 — Wide navigation does not consistently expose or derive the current section**

**Medium · confirmed-source · affected coverage:** Home, Circles, Messages, Profile, Email connection, Chat, Live directory/session, Activity detail, Activity Inbox/Preferences, and shared AppShell.

At wide widths (source breakpoint at 900 available points), the standard rail derives a visual selection but has no `accessibilityState.selected`/current-route equivalent. The route predicate also leaves `/chat/[id]` outside Messages and the separate Live row never becomes selected for `/live` or `/live/*`. `/account/email` is a conditional Profile-child mapping case because it returns to Profile but is not itself a navigation item. Keep the current visible treatment, but implement one route-to-section resolver, include `/chat/` under Messages and `/live` under Live, treat profile-owned `/account/email` consistently, and expose current/selected programmatically.

**Exact source refs:** `components/app-shell.tsx:32-69,57-61,241-303,255-325`; `lib/app-shell-layout.ts:11-31`; `app/(tabs)/_layout.tsx:66-87`; `app/chat/[id].tsx:359-360`; `app/account/email.tsx:18-25`; `components/profile-screen.tsx:425-446`; `app/live/[id].tsx:125-129`; `app/updates/[id].tsx:169-175`.

**D26-06 — Several composite route targets omit explicit role/name semantics, and some lack a declared target minimum**

**Medium · confirmed-source · affected coverage:** Home, Discover, Circles, Messages, Profile/Person, Circle detail, Live, Moderation, Onboarding, Activity detail/Preferences, and shared AppShell.

Moment creation/profile targets, Discover Live cards, wide-shell Live now, sidebar circle image/name targets, and Circle Members rows include `Pressable` route actions without one or both of `accessibilityRole="button"` and a stable action label. Sidebar image and text can also become duplicate, indistinguishable launches; its text-only route target has no declared 44-point minimum. Consolidate thumbnail/name into one named route control where practical (for example, `Open {circle.name}`), keep Join/Open a distinct action, mark redundant imagery non-focusable, and apply declared min-height/hit slop to the intended target. Source omission is confirmed; actual renderer inference and physical geometry remain unverified.

**Exact source refs:** `app/(tabs)/index.tsx:81-129,156-179`; `app/(tabs)/discover.tsx:517-567,529-546`; `components/app-shell.tsx:241-344,304-325,376-393,518-550,519-535`; `lib/app-shell-layout.ts:11-30`; `app/circle/[id].tsx:338-363,605-657`; `app/onboarding.tsx:809-821`; `components/moderation-workspace.tsx:499-520`; `components/circles-ui.tsx:49-60,196-387`.

**D26-07 — Dynamic status/outcome feedback has no consistent announced-status contract**

**Medium · confirmed-source · affected coverage:** Home, Chat, Circle, Create, Live session, Onboarding, Moderation, OAuth callback, Activity Inbox/Detail/Preferences, and shared CirclesProvider notices.

The global four-second pointer-inert notice and multiple local changing messages do not declare an `accessibilityLiveRegion`, alert/status role, or equivalent native announcement mechanism. This affects post/chat/composer mutation messages, auth/check failures, circle mute/save and moderation outcomes, native live transport status, OAuth processing/success/failure, and Activity read/preference outcomes. Preserve nonblocking visual messages and focus, but define one platform-appropriate announcer: polite for progress/success and assertive for terminal/recoverable failure. The source absence is confirmed; actual spoken behavior was not supplied. Avoid duplicate announcements where an inline form error is already assertive.

**Exact source refs:** `hooks/circles-context.tsx:48-52,127-138,152-163,177,179-216,193-216`; `components/post-card.tsx:124-198,218-286,287-309,455-467`; `app/chat/[id].tsx:249-258,329-345`; `app/circle/[id].tsx:249-289`; `components/activity-preferences.tsx:128-157,171-189,202-220,218-219,283-310,347-358,357`; `app/create.tsx:299-317,366-372,417-421,461-496,830-846`; `app/onboarding.tsx:335-340,361-367,419-433,472-478`; `components/moderation-workspace.tsx:347-369,582-602,910`; `app/oauth/callback.tsx:96-99,101-185,214-254`; `components/live-media.native.tsx:1035-1057`; `components/live-media.web.tsx:892-907`; `app/live/[id].tsx:321-338,431-443`; `app/updates/index.tsx:193-221,249-271,348`; `app/updates/[id].tsx:69-93,147-149`.

**D26-08 — Community Sidebar conflates pending, error, and successful-empty recommendations**

**Low · confirmed-source · affected coverage:** Home, Profile/Person, Messages, Activity detail, and every wide screen mounting the shared sidebar over 1,130 available points.

`(circles.data || []).slice(0, 3)` is mapped without loading, error/retry, or empty handling, so a pending query, failure, and zero-result success all render the same unexplained absence of circles. Add compact loading, error-with-`refetch`, successful-empty, and content branches while retaining Explore all circles.

**Exact source refs:** `components/app-shell.tsx:376-392,563-600,563-599`; `lib/app-shell-layout.ts:16-30,18-30,11-31`.

**D26-09 — Guest sign-in nests two dialog frames and two controls for one close action**

**Low · confirmed-source · affected coverage:** Profile, Email connection auth context, Live session, Moderation, Onboarding, and shared authentication modal.

The provider renders outer modal chrome and `Close sign in`; `EmailAuthForm` independently renders an inner card and `Close email sign-in`. Both terminate the same flow. Choose one close-control/frame owner when embedded, but retain a close path for standalone `/account/email`; preserve cancellation/password clearing behavior.

**Exact source refs:** `hooks/circles-context.tsx:218-276,224-274,244-272`; `components/email-auth-form.tsx:264-277,398-439,411-439`; `app/moderation/[circleId].tsx:39-49`.

**D26-10 — Email keyboard Next has no handoff to password**

**Medium · confirmed-source · affected coverage:** `/account/email`, person/profile-auth flows, and shared EmailAuthForm.

The email field advertises `returnKeyType=next` but has no `onSubmitEditing`, password ref, or focus transfer. Only the password field handles terminal submit. Forward the password input ref and focus it on email submit, retaining Done-to-submit; validate software and hardware keyboards after approved runtime enablement.

**Exact source refs:** `components/email-auth-form.tsx:228-236,530-560,545-559`; `components/circles-ui.tsx:389-450`; `baseline.json:9-10`.

### Priority 3 — actionable asynchronous and data-state gaps

**D26-11 — Direct-message “Say hello” does not report pending or prevent repeats**

**Medium · confirmed-source · affected coverage:** `/person/[id]` (another person’s profile).

`message.mutate` is invoked while the initiating Button receives neither `loading` nor `disabled`, unlike the adjacent scoped follow action. Bind `message.isPending` to a specific pending label (for example, “Opening conversation”) and disable conflicting reactivation.

**Exact source refs:** `components/profile-screen.tsx:136-149,234-270,254-260,315-322,470-481`; `components/circles-ui.tsx:196-271`.

**D26-12 — Authentication check/error is rendered as ordinary guest state on inbox/preferences**

**Medium · confirmed-source · affected coverage:** `/messages` and `/updates/preferences`.

These routes interpret a falsey user as guest without preserving the context’s checking/error distinction. During auth error, Sign in calls `showLogin`, which posts a connection notice rather than opening login; the route has no persistent retry. Render a neutral checking state, a clear auth-error state with context refresh/retry, and reserve guest Sign in for `authState=guest`.

**Exact source refs:** `app/(tabs)/messages.tsx:21-28,102-120`; `app/updates/preferences.tsx:22-31`; `hooks/circles-context.tsx:41-46,67-69,179-187`.

**D26-13 — Protected native avatar can temporarily render blank while bearer is pending**

**Low · conditional-source · affected coverage:** `/messages`.

For a truthy protected URI, fallback initials are supplied only after a real image error. The media hook deliberately returns a null source while the native bearer resolves, so the slot may be unpainted during that legitimate pending interval. Keep the authorization boundary, but reserve an initials/neutral placeholder until media is eligible; test native transition without layout shift or stale-media disclosure.

**Exact source refs:** `app/(tabs)/messages.tsx:157-162`; `components/circles-ui.tsx:140-168`; `components/media-image.tsx:57-69,150-173`.

**D26-14 — Long dynamic names are capped with no visible full-name disclosure**

**Low · conditional-source · affected coverage:** Profile/Person, Chat, and Moderator Workspace.

Profile name and conversation title use `numberOfLines={2}`; reported-post author uses one line. A long/localized value or increased text scale can truncate visual identity even where an accessibility label may retain a full name. Allow safe wrapping or provide a visible expansion/detail treatment, then test at supported maximum text scale.

**Exact source refs:** `components/profile-screen.tsx:450-457`; `components/app-shell.tsx:345-362`; `app/chat/[id].tsx:376-393`; `components/moderation-workspace.tsx:499-520`; `components/post-card.tsx:313-339`.

**D26-15 — Embedded guest email form has compact-height/keyboard compression risk**

**Medium · conditional-source · affected coverage:** Profile, Live session, Onboarding, Activity detail, and global authentication modal.

The outer modal uses 24-point inset and 28-point card padding, then nests EmailAuthForm’s 20-point scroll inset and 24-point inner card padding. At a 320-point viewport, supplied analysis leaves roughly 126–128 points before borders for form content. Only the inner form owns keyboard avoidance/scrolling; outer title/logo/close content is outside it and can consume the useful region. Use one dialog surface and place safe-area padding, bounded scrolling, and keyboard avoidance at the modal-owning layer. This is not a rendered clipping observation.

**Exact source refs:** `components/profile-screen.tsx:352-359`; `hooks/circles-context.tsx:218-275,224-274`; `components/email-auth-form.tsx:378-439,379-409,513-647,530-560`; `app/live/[id].tsx:370-376`; `app/updates/[id].tsx:196-253`.

**D26-16 — Create hides a valid deep-linked circle recipient while data is pending/unavailable**

**Medium · confirmed-source · affected coverage:** `/create`.

A retained valid `circleId` is neither Everyone nor an item rendered from `circles.data` during initial loading or error. Submission keeps the ID but the composer has no visible selected/named destination, loading, failure, or retry state. Retain a labelled destination placeholder and explicitly resolve loaded/error/retry states before publish.

**Exact source refs:** `app/create.tsx:157-159,235,449-458,481-485,734-756`.

**D26-17 — Create does not add lateral safe-area insets**

**Medium · conditional-source · affected coverage:** `/create`.

Create reads insets but applies top to root and bottom to scroll content; its fixed 20-point horizontal gutters do not incorporate left/right insets. On an asymmetric landscape/lateral-inset device, content could enter the unsafe edge. Add lateral inset values or a left/right safe-area container; verify on real portrait and asymmetric landscape devices.

**Exact source refs:** `app/create.tsx:147,539-578`; `lib/app-shell-layout.ts:11-31`; `components/app-shell.tsx:88-95`.

**D26-18 — Theme Lab’s unselected palette card lacks persistent control-boundary contrast**

**Medium · confirmed-source · affected coverage:** `/dev/theme-lab`.

In light preview, the inactive dark-preview card is `#FFFFFF` on `#F9F8F5` (**1.06:1**) with `#D0D3C8` border on white (**1.52:1**). In dark preview, the inactive light-preview card is `#252825` on `#1A1C1A` (**1.15:1**) with `#4B5148` border on `#252825` (**1.82:1**). These are below the 3:1 persistent non-text boundary target that communicates the card-sized radio control. Adjust surface/border/background in both schemes and recalculate selected and unselected state.

**Exact source refs:** `app/dev/theme-lab.tsx:89-150,307-316`; `lib/batch5-theme-lab.ts:24-49`.

**D26-19 — Live host has no explained in-route cancellation before camera setup is ready**

**Medium · conditional-source · affected coverage:** `/live/[id]` host state.

Before `LiveMedia` calls `onReady`, `hostGeneration` is null. Back and End live session open a confirmation whose destructive action is disabled in that state, without explanation or alternative cancellation. Make cancellation available once the host owns the generation, or offer a named Cancel camera setup action; otherwise present clear preparation rationale instead of unexplained disabled confirmation.

**Exact source refs:** `app/live/[id].tsx:125-129,289-320,355-365,490-497,621-679`; `components/live-media.web.tsx:711-782`; `components/live-media.native.tsx:891-954`.

**D26-20 — Status text over arbitrary live video may miss contrast**

**Medium · conditional-source · affected coverage:** `/live/[id]` web and native media overlays.

White text over `rgba(0,0,0,0.45)` and arbitrary video can composite to `#8C8C8C` over a white frame, giving **3.36:1** with white. A 54% black layer over white was calculated at **4.61:1**, but an opaque tested status chip/backplate is more robust against video luminance. Render-test bright host/viewer frames.

**Exact source refs:** `components/live-media.web.tsx:892-907`; `components/live-media.native.tsx:1046-1077`; `design-criteria.md:3`.

**D26-22 — Circle Members and Manage lists can silently fall through to blank states**

**Medium · confirmed-source · affected coverage:** `/circle/[id]` Members and Manage.

Members has loading/error before mapping an empty settled list; its end text requires content. Manage maps member/feed arrays with no loading, error/retry, or successful-empty branches. Add explicit Members successful-empty, plus compact loading, retryable-error, empty, and content states for management and moderation lists.

**Exact source refs:** `lib/fnd001-query-display-state.ts:15-29`; `app/circle/[id].tsx:179-190,583-683,755-942`.

**D26-23 — Circle Manage mutations stay actionable while pending**

**Medium · confirmed-source · affected coverage:** `/circle/[id]` Manage.

Role, removal, approval, and managed post-delete actions do not pass `loading`/`disabled` to the shared Button. Track the specific member/post mutation, bind scoped busy/disabled state and action-specific labels, and prevent conflicting repeat activation.

**Exact source refs:** `app/circle/[id].tsx:256-289,850-915,922-940`; `components/circles-ui.tsx:196-271`.

**D26-24 — Repeated onboarding Join controls are not circle-specific to assistive technology**

**Low · confirmed-source · affected coverage:** `/onboarding`.

Each card’s visual title and derived accessible name is the identical “Join this public circle,” despite the circle name being available in the card. Preserve concise visual title but pass `Join {circle.name}` as the accessibility label.

**Exact source refs:** `app/onboarding.tsx:152-230`; `components/circles-ui.tsx:196-228`.

**D26-25 — An unconstrained onboarding category chip may crowd long/scaled content**

**Low · conditional-source · affected coverage:** `/onboarding`.

`Circle.category` is unrestricted. The title can shrink, but the adjacent chip has no flex shrink or width constraint. Bound the chip and define an intentional wrapping/truncation policy, then test long localized categories and text scaling.

**Exact source refs:** `shared/social.ts:12-24`; `app/onboarding.tsx:169-191`.

**D26-26 — Failed chat/post attachment treatment can be indistinct or misleading**

**Medium · confirmed-source · affected coverage:** `/chat/[id]` and `/updates/[id]` PostCard/media paths.

On image error, the shared renderer can replace media with a neutral shape while retaining the original `Photo`/`Video` accessibility label. Chat supplies no tailored visible unavailable state or recovery; protected native source waiting can also be visually empty. Provide a dimension-preserving “Photo unavailable” state with accurate accessible failure copy and bounded retry/reload where meaningful, without weakening account-safe bearer gating. The exact failure occurrence was not rendered.

**Exact source refs:** `app/chat/[id].tsx:537-554`; `components/media-image.tsx:57-68,134-190,141-173,177-190`; `components/post-card.tsx:38-59,85-90,385-400`; `app/updates/[id].tsx:169-175`.

**D26-27 — Wide rails do not reserve bottom safe-area inset**

**Medium · conditional-source · affected coverage:** `/updates/[id]` and any wide AppShell screen with a bottom system/gesture inset.

The shell frame owns top/left/right inset padding; central scroll reserves `Math.max(32, insets.bottom + 16)`, but left rail/right sidebar retain fixed bottom/vertical padding. Make both rail bottoms inset-aware and validate on a wide native gesture-inset device.

**Exact source refs:** `components/app-shell.tsx:88-95,241-343,345-362,376-392`; `lib/app-shell-layout.ts:16-30`.

**D26-28 — Activity row actions omit the specific update and unread context**

**Medium · confirmed-source · affected coverage:** `/updates`.

Every row uses “Open this update” and every unread action uses “Mark update as read,” although title/detail/time/unread data is already available and the unread dot is hidden from accessibility. Construct labels from the update context (for example, “Open update: [title], [detail], [time], unread”) while retaining busy/disabled state.

**Exact source refs:** `app/updates/index.tsx:40-55,90-120`; `lib/activity-ui.ts:262-291`.

**D26-29 — Post options sheet is nested inside a full-screen dismiss Pressable**

**Medium · conditional-source · affected coverage:** `/updates/[id]` PostCard menu.

The action sheet is a child of the same full-screen `Pressable` that calls `setMenu(false)`. Renderer-specific nested press propagation may dismiss an inner action and hide busy state. Use a noninteractive modal root, a sibling action sheet, and a separate backdrop dismissal target; test web, iOS, and Android pending action behavior.

**Exact source refs:** `components/post-card.tsx:651-703`; `components/circles-ui.tsx:196-272`.

**D26-30 — Root notice can overlap OAuth recovery content on compact viewports**

**Low · conditional-source · affected coverage:** `/oauth/callback`.

After a native-login confirmation/cleanup problem, the global fixed-bottom notice can coexist with callback-owned error/recovery content. Callback content has no reserved active-notice height, so compact height or enlarged text may obscure copy/button even though pointer events remain inert. Suppress the provider notice for callback-owned recovery or reserve notice height; validate short landscape and maximum text scale.

**Exact source refs:** `app/oauth/callback.tsx:137-149,170-183,196-253`; `hooks/circles-context.tsx:127-138,193-216`.

**D26-31 — Discover’s route-wide follow flight leaves other controls visibly enabled but inert**

**Medium · confirmed-source · affected coverage:** `/discover` For you and People tabs.

One follow flight locks the entire screen. If another row is activated before settlement, it returns before changing state, but only the originally tapped row is disabled/pending. Use a person-specific single-flight key to support independent rows, or visibly disable the other controls with an appropriate busy explanation while the route-wide lock is active.

**Exact source refs:** `app/(tabs)/discover.tsx:107-108,183-199,345-347,423-428`.

**D26-32 — Own-profile hero actions can exceed the row under narrow/scaled conditions**

**Medium · conditional-source · affected coverage:** `/profile` and `/person/[id]` when viewing the current actor’s own numeric ID.

The 89-point avatar surround and vertical action stack are row children without wrapping. The long “Connect email sign-in” action lacks a width/shrink rule on its Button container. Define a narrow breakpoint that stacks/reflows the hero or constrain the action column with a deliberate full-width/wrapping pattern; validate at 320 points and enlarged system text.

**Exact source refs:** `lib/app-shell-layout.ts:16-30`; `components/profile-screen.tsx:283-288,414-447`; `components/circles-ui.tsx:49-60,224-255`.

D26-21 is retained as a historical alias of D26-07, not an additional defect: native transport announcements are part of the same missing outcome-announcement contract. Editorial closure also corrected the action/soft contrast to 5.95:1 (6.66:1 is secondary/soft), and attributed Say hello only to another-person profiles and the long own-profile action row to own-profile states. Original per-screen evidence remains unchanged.

## Per-route coverage and current positive source evidence

Each entry below identifies the deduplicated findings that cover the route, followed by source-level positives. It does not substitute for rendering verification.

- **`/` — Home:** D26-01, D26-02, D26-05, D26-06, D26-07, D26-08. Root/AppShell apply safe-area insets once, responsive gutters/max widths, wrapping header and bottom inset; narrow tabs expose tab/selected states; feed/comments have loading, error/retry, empty, content and pagination branches; post media/avatar fallbacks and decorative LIVE safeguards are present; auth form has named inputs, autofill, pending/error/availability states.
- **`/discover` — Discover:** D26-01, D26-03, D26-06, D26-31. Search, clear, category selection, People/Circles/Posts/Live loading-error-empty-content/continuation branches, named person return action, guarded post controls, and source safe-area/compact-tab behavior are present.
- **`/circles` — Circles directory:** D26-01, D26-02, D26-03, D26-05, D26-06. Directory search/pills/hero controls are named and selected/sized in source; membership, loading/error/empty/pagination, private/pending, guest auth and media branches are explicit; action/secondary token pairs are recorded as passing in their tested contexts.
- **`/messages` — Messages:** D26-01, D26-05, D26-06, D26-08, D26-12, D26-13. Search/filter and conversation rows have names, selected/busy state and source dimensions; guest, initial load, retryable error and no-results are modeled; shared login fields and avatar/LIVE safety paths are present.
- **`/profile` — Own profile:** D26-01, D26-02, D26-05, D26-06, D26-08, D26-09, D26-14, D26-15, D26-32. Own/person actor distinction, validated person return, profile/feed loading-error-empty states, edit modal keyboard scroll, scoped follow feedback, named/sized shared controls, avatar/media fallback and email-form state branches are positive source coverage.
- **`/account/email` — Email account connection:** D26-01, D26-05, D26-09, D26-10. Explicit checking/auth-error/guest/authenticated branches, history/Profile return, availability/retry/not-ready/disabled/confirmation/error form states, labeled secure fields, busy buttons, and passing ink/action token checks are present.
- **`/chat/[id]` — Direct conversation:** D26-01, D26-02, D26-05, D26-07, D26-14, D26-26. Back has inbox fallback; guest/loading/unavailable/empty/pagination/retry branches are separate; composer and recovery controls expose names/busy state; message layout/media labels and bottom clearance are present in source.
- **`/circle/[id]` — Circle detail and Home:** D26-01, D26-03, D26-06, D26-07, D26-22, D26-23. Invalid/loading/error/unavailable/private/feed/pagination/membership and Circle Home editor/authority branches are explicit; named section/actions, keyboard-aware content, media authorization and avatar safeguards are present.
- **`/create` — Create composer:** D26-01, D26-02, D26-04, D26-07, D26-16, D26-17. Header/entry controls are named; source has keyboard-aware scrolling, selected/disabled pills, scoped publish guard, inline error/retry, clear signed-out action, and account/circle/eligibility-validated introduction prefill.
- **`/dev/theme-lab` — Theme Lab:** D26-18 only. All-edge SafeAreaView, named radio group/actions, source 96/48-point heights, passing stated text/action pairs, wrapping/shrink safeguards and no automatic animation are positive coverage.
- **`/live/[id]` — Live session:** D26-05, D26-07, D26-09, D26-15, D26-19, D26-20. Compact padding, bottom clearance, KeyboardAvoidingView/chat scroll, named composer with busy send, list/chat loading/error/empty/retry, 16:9 media, unsupported-platform alert, and conservative decorative avatar behavior are present in source.
- **`/live` — Live directory:** D26-02, D26-05, D26-06. Directory loading/error/empty/content/live-creation branches, named Live cards, 16:9 thumbnails, media/avatar fallbacks, busy/disabled actions, and email form semantics are positively covered.
- **`/moderation/[circleId]` — Moderator Workspace:** D26-01, D26-03, D26-06, D26-07, D26-09, D26-14. Invalid/auth-checking/guest/authenticated entry states, selected report tabs, queue error/empty/pagination/final/self-review/unavailable/pending/removal confirmation, and source-sized named controls are present.
- **`/oauth/callback` — OAuth callback:** D26-07, D26-30. All-edge safe area, scrollable centered content, bounded plain-language recovery copy, named 48-point recovery action, and measured passing callback contrast are present; no AppShell/tab chrome is expected on this standalone Stack route.
- **`/onboarding` — Onboarding:** D26-01, D26-02, D26-03, D26-06, D26-07, D26-09, D26-15, D26-24, D26-25. Account/recommendation validation and checking/error/mismatch/completed/wizard states, 52-point interest choices, recommendation loading/error/empty/joined/pending branches, responsive AppShell, and email form safeguards are positive coverage.
- **`/person/[id]` — Person profile:** D26-01, D26-06, D26-08, D26-10, D26-11, D26-14, D26-32. Positive ID validation, Discover fallback, loading/error/empty query coverage, source-sized named controls, scoped follow feedback, protected-media gating, and profile/person actor distinction are present.
- **`/updates/[id]` — Activity detail:** D26-01, D26-02, D26-06, D26-08, D26-15, D26-26, D26-27, D26-29. Distinct checking/guest/invalid/loading/retry/unavailable/resolved/mark-read states, current-account freshness gates, named post/shared controls, and central-scroll bottom inset are present.
- **`/updates` — Activity Inbox:** D26-01, D26-02, D26-07, D26-28, D26-29. Explicit checking/guest/load error/empty/unavailable/resolved branches, account-scoped resolver, source-sized row/read/preference controls, named post/media paths and auth form error semantics are covered.
- **`/updates/preferences` — Notification preferences:** D26-01, D26-02, D26-05, D26-06, D26-07, D26-12. Authenticated/guest/checking coverage, 76-point switches with label/hint/checked/disabled/busy state, fetch/write branches and named returns are present.
- **Shared shell, login form, and UI primitives:** D26-01 through D26-10 where applicable, plus D26-08 and D26-26. Shared Button/IconButton/Input naming, busy/disabled and 44/48-point source minima; compact tab selected state; responsive/inset-aware shell; account-safe media; avatar fallback; and EmailAuthForm availability/error/confirmation semantics are positive source evidence. These positives are not a native/rendered certificate.

## Next validation sequence

1. **Token pass:** Change semantic text/active/badge/placeholder/avatar tokens, then calculate every final foreground/background pair before rendering. Prioritize D26-01 through D26-04 and D26-20.
2. **Shared components pass:** Implement AppShell route/current semantics and target naming (D26-05/D26-06), status announcer (D26-07), sidebar states (D26-08), and single guest dialog frame + Next handoff (D26-09/D26-10).
3. **High-value interaction pass:** Resolve Discover follow flight, direct-message and Circle Manage busy states, Circle list states, Create recipient state, Activity names, and failed attachment behavior (D26-11, D26-16, D26-22, D26-23, D26-26, D26-28, D26-31).
4. **Rendered verification after approved changes:** Test web and iOS/Android at narrow, wide (900), sidebar (1,130), notched/asymmetric landscape, 320-point/large-text, keyboard-open, long/localized data, protected-media wait/error, delayed mutation, and bright video. Capture focus order, roles/names/current-state, live announcements, target geometry, notice overlap, and modal dismissal behavior. This is required to validate all conditional-source items and to determine real user impact.

## Criteria references

[1]: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html "W3C Understanding Contrast Minimum"

[2]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html "W3C Understanding Target Size Minimum"

[3]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html "W3C Understanding Target Size Enhanced"

[4]: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html "W3C Understanding Animation from Interactions"
