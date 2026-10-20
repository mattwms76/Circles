# Circles — screen design audit and refinements

**Date:** 20 October 2026  
**Scope:** All 12 production routes, shared navigation/controls, and shared overlays.  
**Status:** Audit completed; targeted design corrections applied. Authenticated-only states and native keyboard behavior were reviewed in source, not claimed visually verified.

## Executive summary

Circles retains its coral, cream and sage identity. The audit focused on margins, padding, typography, wrapping, media proportions, touch areas and overlapping content. Each production route was captured before and after changes at **320 × 740**, **390 × 844**, **768 × 1024** and **1440 × 1000**: 48 route/viewport states in each pass. Login-overlay captures and scroll-end views provided additional evidence.

The most useful corrections were readable shared typography, larger control frames, keyboard-aware forms and sheets, responsive media sizing, long-text resilience and proper line breaks. The after-fix browser pass completed without capture failures or page exceptions, and the document width stayed within the viewport in all 48 states. TypeScript checks and **46 regression tests** passed; one unrelated starter test remains skipped.

This is not a claim that every authenticated state was exercised. No account was fabricated, no live broadcast or conversation was fabricated, and no production data was created for the audit.

## Screen-by-screen coverage

| Screen or surface | Visual evidence | Design corrections / review outcome |
|---|---|---|
| Home feed | Four widths, before/after; scroll-end views | Readable post captions, metadata and actions; consistent photo/video proportions; larger filter targets and explicit horizontal-rail affordances. |
| Discover | Four widths, before/after; scroll-end views | Two-line bios, readable search/body text, contained content width and accessible scrolling filters. |
| Circles browsing | Four widths, before/after; scroll-end views | Removed visible literal `\n` from the hero; responsive card media, readable descriptions/metadata and clearer scrolling categories. |
| Circle detail | Public, signed-out feed at four widths; members/manage/about reviewed in source | Scrollable section strip including Manage; wrapping/stacking moderation actions; intentional rule rows; responsive cover and readable membership metadata. The title-side ring remains an explicitly decorative brand motif. |
| Messages inbox | Signed-out states at four widths; populated rows reviewed in source | Larger search text; long conversation names ellipsize within a flexible column while timestamp/unread metadata has reserved space. |
| Direct and circle conversation | Signed-out gate at four widths; messages/media/composer reviewed in source | Responsive attachment width, consistent aspect ratio, 14px message/composer text, controlled header wrapping, 44px send frame and keyboard-aware layout. |
| Own profile | Signed-out gate at four widths; own profile/editor reviewed in source | Readable biography/stat labels, controlled long-name wrapping and a keyboard-aware editor with responsive modal gutters. |
| Creator profile | Public profile at four widths; scroll-end views | Readable statistics and body copy; shared profile/editor improvements. Follow and message mutations were not exercised. |
| Post / circle / live composition | Signed-out composer at four widths; all three authenticated modes reviewed in source | Keyboard-aware scrolling, wrapping privacy choices, consistent form rhythm and readable secondary copy. |
| Live lobby | Empty public lobby at four widths; populated cards reviewed in source | Responsive 16:9 thumbnails and reduced compounded empty-state spacing. |
| Live viewer / host session | Signed-out gate at four widths; active video/chat reviewed in source | Removed the conflicting 300px wrapper minimum; network guidance moved below video controls; readable chat/composer, resilient title layout and keyboard-aware scrolling. |
| OAuth callback | Missing-parameter error at four widths; processing/success/provider-error states reviewed in source | Bounded friendly error copy, intentional status spacing and a usable Back to Circles recovery button. Secure exchange and token-cleanup behavior retained. |
| Shared shell and navigation | Responsive captures and source | 16px small-phone / 20px regular / 30px wide content gutters; readable desktop sidebar; normal-flow bottom tabs; safe-bottom content clearance; larger navigation targets. |
| Shared overlays | Login visually captured at four widths; comments/editor/confirmations reviewed in source | Login remains unclipped. Comment and profile-editor sheets use keyboard-aware containers, flexible scrolling and safe-bottom padding. |

The internal developer theme laboratory is not a production user-flow screen and is excluded from the route matrix.

## Applied design standards

| Area | Refinement | Main source files |
|---|---|---|
| Typography | Shared text has a 12px minimum and proportional leading. Reading copy and conversation/composer text use 14px; shared form inputs use 16px. Navigation labels increased from 9px to 12px. Small icon glyphs are not counted as reading text. | `components/circles-ui.tsx`, `app/(tabs)/_layout.tsx`, post/profile/chat/live screens |
| Control frames | Shared icon controls are at least 44 × 44px; pills have a 44px minimum height; primary/secondary buttons have a 48px minimum height even where local padding is compact. | `components/circles-ui.tsx`, `components/app-shell.tsx` |
| Gutters and readable width | Shared page gutters respond to viewport width. Scroll content is capped at 760px, with Discover capped at 680px without adding a second set of gutters. Narrow profile-editor outer padding is 16px, with 20px inner padding. | `components/app-shell.tsx`, Discover and profile editor |
| Dynamic text | Names, bios, message previews, metadata and live titles have controlled wrapping/ellipsis and flexible minimum-width-safe columns. | Discover, Messages, Circle detail, profile, chat and live screens |
| Media geometry | Photo/video post media share a 1.38 aspect ratio. Live thumbnails/video use 16:9. Circle media respond to width, and chat attachments are capped to available bubble capacity. | Post card, Circle card/detail, chat and live components |
| Keyboard layout | Compose, chat, live chat, comment sheets and profile editor now use platform-appropriate keyboard avoidance and handled-tap scrolling. This is a source correction, pending physical-device verification. | Compose/chat/live routes, post card and profile screen |
| Intentional copy | Static newline sequences were replaced with real line breaks or rule rows. OAuth errors now have a recovery action rather than a stranded status screen. | Circles browse, Circle detail, AppShell and OAuth callback |

## Overlap findings: important distinction

Some initial item audits treated imagery reaching the viewport edge as bottom-navigation overlap. Subsequent source inspection showed that the custom bottom bar has **no absolute or fixed positioning** and occupies normal navigation layout space. The Home and Discover scroll-end measurements and the reviewed Home bottom capture show the content ending above the bar, with the last post actions and caption reachable.

Similarly, Home/Discover/Circles filter rails intentionally scroll horizontally. A partially visible next option is not document overflow. These rails were retained, with scroll indicators, accessibility labels/hints and trailing inset, instead of shrinking text to force every choice onto a phone-sized row.

These distinctions prevent ordinary scroll behavior from being presented as a confirmed collision. Additional bottom-safe-area clearance was retained without double-counting the full tab-bar height. The detailed initial item reports remain in `design-audit/items/` as before-fix evidence; their hypotheses should be read alongside this final assessment.

## Verification and remaining limits

The full after-fix capture set contains **zero capture failures, zero browser page exceptions and zero document-level horizontal overflow**. The measured visible button/input frames met the 44px audit threshold. Shared secondary reading text is at least 12px; compact icon glyphs can remain smaller. TypeScript, formatting/diff checks and the existing regression suite pass.

The following remain verification gaps rather than claims of completed runtime testing: authenticated profile editing, circle moderation, populated private conversations, active host/viewer video, native camera/microphone permission flows, physical iOS/Android keyboard behavior, hardware safe areas and enlarged system text. Those paths were source-reviewed and refined, but signed-out browser captures cannot establish their native runtime behavior. A formal contrast/screen-reader/localization audit was not part of this pass.

The repeatable capture utility is `scripts/capture-design-audit.py`. Before/after images and raw measurements are local audit evidence and intentionally excluded from versioned application assets. Product code and this report are retained with the source changes.
