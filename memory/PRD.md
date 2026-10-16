# Circles — Product Requirements Document

## Original Problem Statement
Rebuild the "Circles" app (github.com/mattwms76/Circles) as a fresh Expo + FastAPI + MongoDB app that runs in the Expo Go / web preview. Circles is a warm-editorial, interest-based community app.

## User Choices
- Stack: Expo (React Native) + FastAPI + MongoDB (replacing the original Supabase stack).
- v1 features: interest-based circles (browse/join/create), personal timeline feed with posts & photos, direct & circle messaging, live rooms, coins wallet with gifting, moderation, onboarding.
- Auth: Email/password (JWT, custom).
- Design: "Warm editorial" — terracotta accents, Lora serif headings, DM Sans body, light + dark.
- External live-video (Agora) and store purchases intentionally skipped / simulated for v1.

## Architecture
- Backend: `/app/backend/server.py` (FastAPI). UUID string ids (no ObjectId), JWT via pyjwt + bcrypt. All routes under `/api`.
- Media: Emergent-managed Object Storage. Upload via `POST /api/upload`; served (public) via `GET /api/files/{path}`.
- Frontend: expo-router file-based routing. React Query for server state. Theme tokens in `src/theme.ts` (light + dark). Fonts Lora + DM Sans + Feather loaded via expo-font.
- Navigation: 4 bottom tabs (Home, Circles/Discover, Rooms, Messages). Profile/Wallet/Moderation/Circle/Post/Chat/Room are stack screens.

## User Personas
- Explorer: joins circles, reads the feed, comments, sends messages, buys/gifts coins.
- Host/Owner: creates circles, posts, schedules live rooms, manages their community.
- Moderator: reviews reported content (guide account seeded as moderator).

## Core Requirements (static)
- Secure email/password auth with persisted session.
- Onboarding that captures interests and suggests circles to join.
- Feed scoped to joined circles (public fallback when empty).
- Create posts with text + photo; like + comment.
- Circle directory with search + category chips; circle detail with Posts/Events/About.
- Direct + circle group messaging.
- Live rooms (simulated audio) with real-time text chat.
- Coins wallet with buy + gifting (server-verified balances).
- Moderator-only report queue.

## Implemented (2026-10-16)
- Auth: register / login / me, un-onboarded routing to onboarding. (25/25 backend tests pass)
- Onboarding: interest selection + suggested-circle joining.
- Circles: list/search/category/mine, create (with cover upload), detail, join/leave, members, events.
- Feed + posts: timeline with public fallback, create (text+image), like toggle, comments, author/mod delete (soft).
- Messaging: conversations inbox (auto-creates circle chats), direct conversations, send/read with polling.
- Live rooms: create (go live), join/leave, participants, live text chat, mic toggle (demo).
- Wallet: balance, buy coin packs, transactions; gifting with insufficient-funds handling.
- Moderation: report creation + moderator-only queue.
- Profile: edit name/bio/avatar, wallet + my-circles + moderation shortcuts, sign out.
- Design: full warm-editorial theme, Lora/DM Sans fonts, Feather icons, light + dark, toasts.

## Implemented — Iteration 2 (2026-10-16) — 17/17 new backend tests pass
- Unread: per-conversation unread counts, total-unread endpoint, read-on-open, inbox count badges + bold snippets, Messages tab numeric badge.
- Typing: 6s TTL typing flag per conversation; chat shows "X is typing…".
- Events & RSVP: host schedules events (title/description/datetime picker), members RSVP/un-RSVP, "N going" counts.
- People tab: 4th circle tab listing members with a one-tap message (direct chat) button; About tab is description-only.
- Live Rooms seats: raise-hand toggle, host promotes listeners to co-host (max 3 seats) / demotes, role + raised-hand badges on stage. (Real audio still needs Agora + native build.)

## Implemented — Iteration 5 (2026-10-16)
- Supporter Perks: `author_is_supporter` flag on posts & comments (top-3 circle gift senders) → "Top supporter" pill on posts, star on comments.
- Mute & Ban: owners/moderators mute a member (30 min, blocks posting/commenting) or remove them (deletes membership + 60-min rejoin ban), via a manage sheet in the People tab; muted members show a label.
- Event Calendar: /calendar month view (opened from Home header) listing upcoming events across joined circles with day-dots and inline RSVP. GET /api/events/upcoming.

## Implemented — Iteration 4 (2026-10-16)
- Moderator Tools: owners/moderators remove posts in their circle; any member can report a post (⋯ menu); circle-scoped report queue (/circle-reports/{id}) with remove/dismiss; deleting a post auto-resolves its reports. (19/19 tests)
- Reminder Nudges: NudgeWatcher toasts once when an RSVP'd event starts within the hour (dedup in storage), on top of the 24h Home banner.
- Gift Leaderboard: gifts attributed to their circle; circle People tab shows "Top supporters" (top coin senders).

## Implemented — Iteration 6 (2026-06, fork) — 17/17 backend tests pass
- Backend polish: mute/ban duration capped at 7 days (MAX_MOD_MINUTES=10080, clamp_minutes); GET /circles/{id}/members now returns muted_until; event starts_at normalized to UTC on write (norm_iso).
- Design-system fixes (8): raised light `muted` contrast to ~4.9:1; added central `type` scale in theme.ts; Chip + Button-small bumped to 44px touch targets; new `CoinIcon` (terracotta $ token) replacing empty-ring placeholder in Wallet; supporter badge 10→11px; hitSlop on post like/comment/gift; fixed Discover category-chip clipping; removed ~22 redundant fontFamily overrides across 15 files.

## Compliance X1–X7 (2026-06, fork) — IMPLEMENTED & VERIFIED (iter8: 31/31 tests pass)
Against global social-media legislation (EU DSA/GDPR, UK OSA, US COPPA/state, AU under-16, India DPDP, Brazil ECA Digital):
- X1/X7 Legal + consent: in-app Privacy Policy & Terms screens (app/legal/[doc].tsx), consent checkbox at register, server-tracked consent (consents collection) + GET /api/legal versions.
- X3 Age gate: DOB required at register; under-13 blocked (403, MIN_AGE=13); 13–17 flagged is_minor=true with high-privacy defaults (minors see no gifting prompts).
- X2 Data rights: GET /api/users/me/export (full data portability JSON + share/download) and DELETE /api/users/me (erasure; blocked for circle owners until transfer) + Profile UI.
- X4 Blocking: blocks collection; block/unblock/list; enforced in feed, start_direct, send_message (both directions); Block+Report on user profile; Blocked accounts screen.
- X5 Illegal-content: report categories with priority set (csam/illegal/self_harm/violence) → GET /api/moderation/priority queue for moderators + logged/escalation warning. (Real CSAM hash-matching/NCMEC = separate vendor integration — NOT built.)
- X6 Reporting breadth + feedback: ReportSheet with categories; report post/comment/message/user/room; GET /api/reports/mine (status); DSA statement-of-reasons via moderation_actions (logged on remove/mute/ban) → GET /api/moderation/actions/mine; appeals (POST .../appeal, GET /api/moderation/appeals) + my-activity screen.
Residual/known gaps (documented, not built): real age-assurance vendor; CSAM hash-matching; formal UK/EU risk-assessment documents; signed URLs for private media; DELETE /users/me is non-atomic on standalone Mongo.

## Security Audit (2026-06, fork) — ALL ITEMS FIXED & VERIFIED (iter7: 31/31 backend tests pass)
- SEC-001 CRITICAL ✅ Seed accounts gated behind ENABLE_DEMO_SEED env; passwords sourced from GUIDE_PASSWORD/DEMO_PASSWORD env (no credentials in source); production leaves seeding disabled.
- SEC-002 HIGH ✅ Conversation messages/read/typing gated by get_conv_or_403 (direct→members, circle→circle membership); non-members 403.
- SEC-003 HIGH ✅ create_post/add_comment require membership + not banned + not muted (assert_can_write); private circles gated for reads (assert_can_read_circle); discovery hides private non-member circles.
- SEC-004 MEDIUM ✅ Atomic conditional $inc debit in /gifts (no negative balance); /wallet/buy capped at 100000 (still simulated top-up, no real payment by design).
- SEC-005 MEDIUM ✅ /api/files/{path} rejects '..' and non-'circles/' prefixes (traversal blocked). Residual: uploaded images remain public-by-unguessable-UUID-URL (no per-user auth — would need signed URLs).
- P3 ✅ email removed from public_user (self keeps it via private_user); JWT secret length guard; .env gitignored; CORS allow_credentials=False; slowapi rate limits (login 10/min, register 5/min); regex-escaped circle search; max_length bounds on post/message/circle/event/room inputs.
- Backlog (non-blocking): Redis-backed rate limiting for multi-worker scale; signed URLs for private media; split server.py into routers.

## Pending — Real Live Audio (Agora) [AWAITING KEYS + NATIVE BUILD]
- Playbook obtained (react-native-agora 4.x native + agora-rtc-sdk-ng web; FastAPI RTC token endpoint with agora-token-builder).
- Requires AGORA_APP_ID + AGORA_APP_CERTIFICATE from the user; cannot run in Expo Go/web preview (needs a dev/native build). The raise-hand/co-host stage is already built and will attach to Agora audio once keys are provided and a build is generated.
- Circle Roles: owner-only PUT /circles/{id} (edit welcome message / name / description); POST /circles/{id}/members/{uid}/role to name or remove moderators. Pinned welcome banner on Posts tab; owner welcome editor in About; moderator toggle in People tab.
- Gift On Posts: PostCard gift action (non-own posts) + live-room "cheer host" open a GiftSheet (Heart→Rocket); gifts debit/credit coins, are recorded, and show a gift_count on posts. Self-gifting blocked at the API.
- Event Reminders: GET /reminders returns RSVP'd events starting within 24h; Home shows a dismissible "Starting soon" banner that opens the circle.

## Backlog / Remaining
- P1: Real-time via websockets (currently polling); server-persisted reminder dismissal.
- P2: Real live audio (Agora) — needs App ID + native dev build.
- P2: Real in-app purchases (store) — currently simulated top-ups.
- P2: Mongo transaction around gift debit/credit; optimize feed gift_count (N+1) before scale.
- P2: Stories, post bookmarks, richer moderation actions.

## Next Tasks
- Add unread badges + websocket realtime for chat/rooms.
- Event scheduling UI inside circle detail.
- Push notifications (only on explicit request; needs deployed build).
