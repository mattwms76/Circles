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

## Backlog / Remaining
- P1: Real-time via websockets (currently polling); unread counts on inbox; chat header avatar.
- P1: Circle events creation UI (backend ready); RSVP.
- P2: Real live audio (Agora) — needs App ID + native dev build.
- P2: Real in-app purchases (store) — currently simulated top-ups.
- P2: Stories, post bookmarks, richer moderation actions (remove/audit).

## Next Tasks
- Add unread badges + websocket realtime for chat/rooms.
- Event scheduling UI inside circle detail.
- Push notifications (only on explicit request; needs deployed build).
