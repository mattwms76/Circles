# Circles browsing — design audit

**Screen:** Circles browsing (`/circles`)  
**Evidence:** clean signed-out captures at 320×740, 390×844, 768×1024, and 1440×1000 plus `before/metrics.json`. Visual findings are limited to those captures; loading/error/empty, joined-only, auth-gated actions, moderation, editing, and overlay behavior are source-reviewed only because those states were not captured.

## Findings

### 1. Hero line break renders as literal `\\n` (visually confirmed; shared content bug)
- **Severity:** high
- **Location:** `app/(tabs)/circles.tsx:86-95`
- **Evidence:** `circles-small`, `circles-mobile`, `circles-tablet`, and `circles-wide` all show `Big passions.\\nYour kind of people.` rather than a line break. The source text contains the escaped sequence inside the `T` child.
- **Minimal fix:** use a JSX line break (`Big passions.<Text>{"\\n"}</Text>...`) or an actual newline/explicit two-line layout; verify the resulting line-height and contrast over the image. This is not a spacing issue and should be fixed before tuning hero padding.

### 2. Fixed bottom navigation can occlude the first card on the smallest viewport (visually confirmed; shared shell/scroll risk)
- **Severity:** high
- **Location:** `components/app-shell.tsx:280-287`; content begins in `app/(tabs)/circles.tsx:181-214`
- **Evidence:** in `circles-small` the card starts around y=552 and its image continues behind the fixed bottom tab bar beginning around y=700; the card title/action content is not reachable in the captured viewport. `metrics.json` reports the 320px document width but no bottom-clearance guarantee. The mobile shell only adds `paddingBottom: 32`, while the visible tab bar is materially taller than that.
- **Minimal fix:** reserve bottom safe-area plus tab-bar height in the scrolling content (or make the tab bar part of layout rather than overlay), e.g. a measured footer spacer; validate at 320×740 with the final card action reachable. Preserve the existing 20px side gutter.

### 3. Primary/secondary controls miss the 44px touch-target goal (source risk; not all visually verifiable)
- **Severity:** medium
- **Location:** `components/circles-ui.tsx:216-224,257-287`; `app/(tabs)/circles.tsx:41-55,153-177`; `components/circle-card.tsx:87-107`
- **Evidence:** metrics measure header icon controls at 38×40. `IconButton` is icon 22 + 8px padding (38px visual box; hitSlop is not a reliable visual target). `Pill` computes to about 38px high, and the Discover/Your circles `Pressable`s have only text line-height with no vertical padding. Circle-card Join overrides `Button` to 8px vertical padding, about 37px high. These conflict with the requested 44px goal, especially on mobile; compact category badges remain intentionally compact/noninteractive.
- **Minimal fix:** give interactive controls a `minHeight: 44` (and centered content), including tabs and Join; retain compact sizing only for noninteractive category labels. Avoid changing badge typography.

### 4. Small-screen browsing has a clipped card rather than a deliberate responsive card treatment (visually confirmed)
- **Severity:** medium
- **Location:** `components/circle-card.tsx:26-30,68-109`; `app/(tabs)/circles.tsx:181-214`
- **Evidence:** at 320px the first card image is visible, but the fixed 172px media plus card body extends under the bottom navigation; at 390px the card description is cut at the viewport/nav boundary. At 768px and 1440px the same fixed media geometry reads cleanly. This is a viewport-clearance/vertical-rhythm failure, not an intentional compact badge.
- **Minimal fix:** combine shell bottom clearance with a narrow breakpoint that reduces media height modestly (or keep media height and ensure the first card body is scroll-reachable); do not truncate the description further than the existing two-line cap.

### 5. Long category rail is source-safe but its affordance is weak at 320/390px (visually confirmed, low-risk)
- **Severity:** low
- **Location:** `app/(tabs)/circles.tsx:131-152`; `components/circles-ui.tsx:245-287`
- **Evidence:** the 320px capture visibly cuts the Design pill at the right edge and the 390px capture cuts Photography; `metrics.json` records later pills offscreen while document width remains viewport width. This is horizontal scrolling, not page overflow, but there is no fade/scroll cue and the 38px pill height is also below the touch goal.
- **Minimal fix:** keep the horizontal `ScrollView`, add a subtle edge cue or ensure the selected item auto-scrolls into view, and raise interactive pill height to 44px while preserving 12px label text.

### 6. Card and filter hierarchy is generally strong, but secondary metadata is below the stated readability floor (source risk)
- **Severity:** low
- **Location:** `components/circle-card.tsx:74-85`; `components/app-shell.tsx:353-357,373-381`
- **Evidence:** card description is 12px (acceptable minimum) but member/privacy metadata is 11px; wide sidebar metadata and Join controls use 10px. The wide screenshot remains readable at desktop scale, but these values are below the stated secondary-text goal of ≥12px. Category badges are intentionally compact and should not be enlarged solely for this rule.
- **Minimal fix:** use 12px for card/sidebar secondary metadata (with line-height ≥18px); retain 10px only for clearly nonessential compact labels/badges.

## Source-reviewed conditional and interaction coverage

- **Loading, error, empty, and joined-only states:** explicit branches at `app/(tabs)/circles.tsx:182-210`; no corresponding captures, so no visual claim made.
- **Signed-out auth gates:** create-circle action at `app/(tabs)/circles.tsx:41-44`; join action at `components/circle-card.tsx:98-102`; behavior is source-reviewed only.
- **Join/pending moderation state:** `circle.role === "pending"` changes label/disabled state at `components/circle-card.tsx:89-101`; mutation feedback at `components/circle-card.tsx:14-23`. No pending/toast overlay capture was supplied.
- **Editing/moderation overlays:** no editing or moderation UI is rendered in the assigned browsing files; not visually verified and not inferred from other screens.
- **Safe areas/header:** mobile top inset is applied at `components/app-shell.tsx:71-76`; wide layout switches at 900px and sidebar at >1130px (`:63-64,295-310`). The four captures show consistent 20px mobile/tablet and 30px central wide content gutters, with no document-width overflow.

## Positive baseline

Coral/cream/sage identity is consistent, gutters are broadly coherent (20px mobile/tablet, 30px central wide), hero/card corner radii and media crops are consistent, and the wide three-column breakpoint provides good hierarchy without horizontal overflow. No overlapping text or broken card geometry was visually confirmed beyond the literal hero escape and bottom-nav occlusion.