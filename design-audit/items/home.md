# Home feed — visual/design audit

**Screen:** Home feed (`/`)  
**Evidence:** clean signed-out captures at 320×740, 390×844, 768×1024, and 1440×1000, plus `before/metrics.json`.  
**Identity:** coral/cream/sage palette is coherent and visually preserved.  

## Findings

1. **Mobile feed content is occluded by the fixed bottom navigation** — **High**  
   - **File/line:** `components/app-shell.tsx:280-287` (scroll content padding); corroborating `design-audit/before/home-mobile.png`.  
   - **Evidence:** At 390×844 the first post's media/action boundary reaches the fixed tab bar at ~798px; the action row is only partially visible immediately above it. The 320×740 capture similarly leaves very little content clearance above the nav. `AppShell` provides only a fixed `paddingBottom: 32` to the scroll content and no bottom safe-area inset in this layout.  
   - **Minimal fix:** reserve bottom space equal to tab-bar height plus `insets.bottom` (or make the tab bar part of layout rather than overlay), and verify the last interactive row can scroll above it.  

2. **The horizontal filter rail hides “Live now” at narrow widths** — **Medium**  
   - **File/line:** `app/(tabs)/index.tsx:105-142`.  
   - **Evidence:** Metrics report `Live now` offscreen at x=349 on 320px and 390px captures (x=349 on both); the 320px screenshot visibly ends after “Your circles.” This is a horizontal scroller, but the primary live entry is not discoverable without a swipe and has no scroll cue.  
   - **Minimal fix:** keep the rail scrollable but make the final item partially peek (reduce gaps/pill padding at `<390`), or move Live into a second line/compact overflow control at the narrow breakpoint.  

3. **Video posts have a fixed, inconsistent media geometry** — **Medium / source risk**  
   - **File/line:** `components/post-card.tsx:29-40`.  
   - **Evidence:** `PostVideo` hard-codes `height: 330` while image posts use `aspectRatio: 1.38` at lines 163-168. At the 390px card width this makes video substantially taller than image posts; at tablet/wide widths it becomes comparatively shallow. No video state is present in the signed-out captures, so this is source-reviewed rather than visually verified.  
   - **Minimal fix:** use the same aspect-ratio container (or derive height from card width) for video and image media, preserving `contentFit="cover"`; test controls at each breakpoint.  

4. **Post body and metadata typography is below the stated readability goal** — **Medium / source risk**  
   - **File/line:** `components/post-card.tsx:109-120, 192-201, 226-237`; shared default `components/circles-ui.tsx:39-45`.  
   - **Evidence:** Caption body is explicitly 12px/19px, comment count 11px, author handle/time 10px, and comment text 13px. The audit goal is body 14–16px and secondary ≥12px. The first mobile capture has the post caption below the viewport, so these sizes cannot be fully judged visually here; source evidence indicates likely small text and weak hierarchy on long content.  
   - **Minimal fix:** set post body/comment text to 14px with a 21–22px line height; raise handle/time and comment-count metadata to at least 12px, retaining compact 10px only for intentional badges (the circle badge is appropriate).  

5. **Interactive controls are laid out below the 44px touch-target goal** — **Medium / source risk**  
   - **File/line:** `components/circles-ui.tsx:257-287` (Pill), `components/circles-ui.tsx:215-224` (IconButton), `components/post-card.tsx:180-205` (like/comment actions).  
   - **Evidence:** Metrics measure post `IconButton`s at 36×39px; the source gives action pressables only 5px vertical padding and pills 9px around an 18px line-height (about 36px before hit slop). Hit slop helps IconButton activation but does not enlarge layout spacing or reliably help adjacent controls.  
   - **Minimal fix:** provide a minimum 44px height/width for all interactive controls (including pills and action buttons), while keeping visual glyphs/badges compact and increasing gaps to prevent accidental neighboring taps.  

6. **Comment composer is vulnerable to keyboard occlusion** — **Medium / source risk**  
   - **File/line:** `components/post-card.tsx:240-264, 314-355`.  
   - **Evidence:** The comments overlay is bottom-aligned with `maxHeight: "80%"`, but there is no `KeyboardAvoidingView`, keyboard inset handling, or scroll-to-focused-input behavior. Signed-out captures cannot open the gated conversation flow, so this is not visually verified. Long comments plus the 12px/13px text styles also leave limited vertical room.  
   - **Minimal fix:** wrap the sheet in keyboard-aware layout, apply bottom keyboard inset, and keep the composer visible while scrolling the comments list.

## Conditional modes reviewed

- **Signed-out/auth gates:** `requireAuth` protects create, like/save/comment, report, and circle navigation (`index.tsx:61-63`, `post-card.tsx:180-224, 342-351, 388-407`). These gated states were **source-reviewed only**, not claimed visually verified.
- **Moderation:** the ellipsis menu is a centered dimmed modal with report and owner-only remove actions (`post-card.tsx:359-412`). No visual capture exists for it; the 36×39px trigger is covered by finding 5. The source exposes removal, not an edit action; no editing surface is assigned in this Home feed item.
- **Overlays:** comments and moderation modals use dimming and bottom/center placement (`post-card.tsx:240-412`); keyboard behavior is the source risk above.
- **Breakpoints:** wide layout switches at `width >= 900` (`app-shell.tsx:63-64`) and adds sidebar only above 1130 (`app-shell.tsx:295`). The wide capture is balanced with consistent 30px content padding; tablet/mobile use consistent 20px outer gutters. No horizontal document overflow was reported (`documentWidth` equals viewport in all Home metrics); the narrow rail overflow is contained intentional scrolling, not document overflow.
