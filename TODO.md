# Circles — approved outcomes

- [x] Cross-platform React Native mobile app for iOS and Android with onboarding, profiles, and social connections; preserve the fixed Expo starter and native identifiers. Deliver distinct Circles launcher, splash, adaptive, monochrome and favicon assets.
- [x] Personalized home feed for discovering and engaging with posts from people and joined circles. Create photo, video, and text posts with captions, reactions, comments, sharing, and reporting. Public starter community content is viewable without login; all personal actions require a validated real account.
- [x] Create, discover, join, leave, and view circles with public or private membership options. Circle-specific feeds let members publish posts and interact with community content. Private circle content is restricted to approved members.
- [x] Circle roles and governance: the creator is owner/admin, can appoint or remove moderators; owners and moderators can manage members and moderate content. Protect owner role and enforce permissions server-side.
- [x] Real-time group chat for each circle, supporting ongoing conversations among approved members with persistent messages and near-real-time refresh.
- [x] Private direct messaging between users with conversation lists, message status, and media sharing; restrict messages to conversation participants.
- [x] Live video streaming with audience viewing and real-time chat or reactions. Implement actual WebRTC media and signaling where supported, and explicitly surface native-build and network requirements rather than presenting prerecorded media as live.
- [x] Search and discovery for users, circles, posts, and live streams.
- [x] Read-only implementation review, TypeScript diagnostics, server build and existing/unit checks; save a Manus checkpoint and keep Metro/API ready for Dashboard Preview and native builds.

## Delivery evidence

The social and live schemas have been migrated additively. The public starter seed is completion-marker guarded and its no-op rerun exits cleanly. TypeScript checks, 46 regression tests (with one unrelated starter test skipped), the API build and diff checks pass. Both mobile listeners return HTTP 200; public feed/profile/circle discovery and unauthenticated mutation rejection were exercised against the real API. Private uploads use authenticated encrypted storage and resource-authorized reads. The read-only implementation review identified issues in pending approvals, receipts, media-only messages and live leases; those targeted issues have been repaired and covered by focused tests. Final Expo export compiled iOS and Android Hermes bundles and the web bundle/static routes successfully with bounded worker concurrency. The accepted source is ready for checkpoint recording and Dashboard native build actions.

- [ ] Physical iOS/Android device and camera/microphone end-to-end verification; this is not established by a web preview or a source bundle.
- [ ] Production TURN relay / scalable streaming service and multi-instance OAuth pending-state persistence before a large public launch.
- [ ] Signed store build and App Store / Play Store submission; source/configuration is prepared for the Dashboard build actions, but no release artifact is claimed.

## Implementation notes

The confirmed blueprint is the approved plan. The supplied managed database is enabled by the mobile starter even though additional optional power-ups were not selected. Use real Manus OAuth and protected mutations, managed MySQL and object storage. Group and direct conversations refresh on a short interval; WebRTC uses authenticated persistent signaling. Live delivery on restrictive networks requires a production TURN service, and native WebRTC needs a development/release build rather than Expo Go. Do not claim those surfaces tested without evidence.

## Visual direction

Warm editorial community design: porcelain backgrounds, ink typography, ownable vermilion coral (#ED604A), understated sage accents and thin dividers. A custom overlapping-ring mark and lowercase tightly tracked wordmark lead a portrait, one-handed interface. Spacious feed photography, circular story portraits, small editorial labels and pill filters feel expressive without copying the competitor brands. Responsive wider previews extend the same design with a left navigation rail and a right community sidebar. Typography uses a system sans-serif with heavy, tightly tracked headlines and readable 14–16px body text. Interaction uses quick pressed states and restrained fades; navigation remains stable and accessible. Brand voice: friendly, specific, inclusive. “Find your people.” “A little closer to what you love.”

## Screen design audit — requested 20 October 2026

- [x] Audit every production screen and shared overlay for design consistency, margins, padding, font size, text wrapping, clipping, and overlapping content. Include Home, Discover, Circles, Circle detail/member/manage states, Messages, Conversation, own Profile, creator Profile, post/circle/live composition, Live lobby/session, OAuth callback and shared navigation, sign-in, comments and confirmation sheets.
- [x] Check small portrait (320px), standard portrait (390px), tablet (768px) and wide preview (1440px) layouts where browser rendering is available. Keep authenticated-only states source-reviewed unless an actual authorized session is available; do not invent a logged-in user or create test production data.
- [x] Fix confirmed layout issues while preserving the Circles visual identity and functionality. Maintain comfortable reading sizes, adequate touch targets, consistent screen gutters, safe-area handling, horizontal filter scrolling and keyboard-safe composition. Recheck affected layouts and TypeScript/tests, and save the source changes.

Design audit evidence: all12 production routes were captured at320/390/768/1440px before and after refinements (96route/viewport states), plus login and scroll-end evidence. Shared typography/control sizing, responsive media, wrapping, form/overlay keyboard-aware structure and static copy were refined. TypeScript and46tests pass; physical-device and authenticated-state runtime limits remain explicit in design-audit/design-audit.md.

## Embedded Preview fetch recovery — 20 October 2026

- [x] Web Preview loads social/API data through its own origin without depending on a separate cross-origin API hostname. Preserve the fixed API port 3000 and Metro port 8081, native API routing, existing resource authorization, exact CORS allowlists, host-only secure session cookies and OAuth state validation. API failures return an actionable retry state rather than a fabricated empty feed.

Evidence: the public Preview now forwards `/api/` requests to the fixed local API through a streaming Metro proxy. Only the gateway's exact paired internal Host/Origin is restored to the configured public origin. TypeScript and 53 active regression tests pass (one unrelated starter test remains skipped). A cross-site iframe smoke check loads the guest feed with all requests to the old API host blocked; safe browser POST reaches Express without origin rejection. OAuth initiation issues Secure/SameSite=None state cookies and untrusted origins remain rejected. API/Metro are independent resident services; native routing and identifiers are unchanged. Existing API-host web cookies are not transferred between hosts, so a previous web session may require sign-in again after refreshing Preview.
