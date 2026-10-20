# Discover — visual/design audit

**Capture set:** signed-out Discover at 320×740, 390×844, 768×1024, and 1440×1000. **Identity:** coral/cream/sage treatment is coherent; no color-system regression found. Findings distinguish screenshot-confirmed defects from source risks. Gated/live states were source-reviewed only.

## Issues

### 1. Mobile tab rail is horizontally clipped
- **Severity:** High
- **File/line:** `app/(tabs)/discover.tsx:77-90`
- **Evidence:** Visually confirmed at 320 and 390: the `Posts`/`Live` pills are cut at the right edge; metrics report `Live` offscreen at x=352 on the 320 capture. The horizontal ScrollView intentionally permits scrolling, but the initial state exposes a truncated control with no affordance.
- **Minimal fix:** Keep the rail horizontally scrollable, but ensure the initial viewport ends on a complete pill (e.g. reduce pill horizontal padding/gap at ≤360, or add trailing inset and scroll-to-selected/visible behavior). Do not shrink label text below the existing 12px.

### 2. Fixed mobile bottom navigation occludes Discover content
- **Severity:** High
- **File/line:** `components/app-shell.tsx:280-287` (shared shell; mobile nav is rendered outside the audited screen)
- **Evidence:** Visually confirmed: at 320, the fourth person card continues beneath the bottom bar and is cut at the viewport edge; at 768, the first circle media/card is visibly hidden behind the bottom bar. Shell content reserves only 32px bottom padding while the fixed navigation is materially taller (~60px).
- **Minimal fix:** Reserve bottom space equal to the nav height plus `insets.bottom` (and apply it to every scrollable shell), or render the nav in normal layout flow. Verify the last card/media can scroll fully above the bar.

### 3. Follow buttons and filter pills miss the 44px touch-target goal
- **Severity:** Medium
- **File/line:** `app/(tabs)/discover.tsx:138-149`; shared `components/circles-ui.tsx:257-287`
- **Evidence:** Metrics measure Follow controls at 66×37px. `Button` is overridden to `paddingVertical: 8` around 21px text, and `Pill` is approximately 36px tall (`paddingVertical: 9` + 18px line-height). These are visually neat but below the requested 44px target, especially for primary Follow actions.
- **Minimal fix:** Give Follow a 44px minimum height (retain compact visual styling with internal alignment), and give each pill a 44px hit area via `minHeight`/hitSlop without changing its compact badge-like appearance.

### 4. Person bios are hard-clipped instead of wrapping or gracefully truncating
- **Severity:** Medium
- **File/line:** `app/(tabs)/discover.tsx:124-136`
- **Evidence:** Visually confirmed on 320/390: bios end in ellipsized/clipped text (e.g. “Noticing the generous little details.” and “Designing with people, not around …”); source explicitly sets `numberOfLines={1}`. On narrow cards, the available text column is only about 112px in metrics, making the loss substantial.
- **Minimal fix:** Allow two lines at widths ≤390, or use a deliberate ellipsis with a wider flex allocation by reducing card/button spacing; preserve the 11px secondary size only if line-height remains readable.

### 5. Scroll/input safe-area and keyboard behavior are source risks
- **Severity:** Medium (source risk; not visually verified in the supplied signed-out captures)
- **File/line:** `components/app-shell.tsx:71-76, 280-287`; `app/(tabs)/discover.tsx:64-70`
- **Evidence:** Shell applies top safe-area padding but no bottom inset to its scroll content; the search `TextInput` has no keyboard-avoidance or focus-scroll handling. This is consistent with the confirmed bottom occlusion and risks the search field/results being hidden by an on-screen keyboard, especially on short devices.
- **Minimal fix:** Add bottom safe-area + fixed-nav clearance to scroll content and use the app’s keyboard-aware scroll/avoidance pattern so focused search input and result rows remain visible. Validate at 320×740 with the keyboard open.

### 6. Wide layout creates a very broad central content column without an explicit readable max width
- **Severity:** Low
- **File/line:** `app/(tabs)/discover.tsx:92-171`; `components/app-shell.tsx:170-176, 280-287`
- **Evidence:** Visually confirmed at 1440: the central Discover column is about 687px wide between the 226px nav and 296px sidebar, while each person card spans the full column, leaving a long scan from avatar to Follow button. Tablet similarly stretches cards nearly edge-to-edge. This is not overflow, but it weakens readable grouping and vertical rhythm.
- **Minimal fix:** Cap the Discover main content column/cards around 640–680px or reduce card horizontal expansion at wide widths, while keeping the sidebar and the existing 30px shell gutter. Preserve the current coral/cream/sage hierarchy.

## Conditional/source-reviewed coverage

- **Authentication gates:** Follow uses `requireAuth` before mutation (`discover.tsx:138-143`); “Go live” uses `requireAuth` before navigation (`discover.tsx:211-218`). These gated states were **not claimed visually verified** because captures are signed out.
- **Live mode:** Source reviewed at `discover.tsx:188-221`; live-card media is 180px high and titles are unbounded, so long live titles remain a conditional wrapping risk. No live session existed in the supplied captures.
- **Posts, circles, People, and For you modes:** Source branches reviewed (`discover.tsx:92-186`). Empty/loading states use shared primitives; no separate captured state was supplied.
- **Moderation/editing/overlays:** No moderation or editing controls are present in this Discover source. Search clear control is source-present (`discover.tsx:71-75`) but not exercised in the signed-out screenshots; keyboard/focus behavior remains a source risk above.
