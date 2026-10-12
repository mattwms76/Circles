# Circles

Circles is an Expo and React Native iOS/Android social app foundation. It includes interest-based public and private circles, text and media posts, live rooms with a host and up to three co-hosts, seat requests, gifts, mutual-follow direct messages, and reporting/blocking flows. When Supabase is not configured, the app opens in a seeded demo mode so the interface can be explored.

## Run the app

1. Install Node.js and pnpm, then run `pnpm install`.
2. Copy `.env.example` to `.env.local` and set the Supabase project URL, publishable key, and Agora App ID. The current workspace already has its ignored `.env.local` pointed at the connected Supabase project.
3. Create an iOS/Android development build with `pnpm ios` or `pnpm android` (or configure EAS and run `eas build --profile development`). Expo Go is not supported because Agora and in-app purchases use native modules.
4. Start Metro with `pnpm start` and open the installed development build.

The iOS deployment target is 16.4 for the Expo IAP native module. Android builds require the standard Expo Android toolchain.

## Supabase setup

The current workspace is connected to the Supabase project configured in `.env.local`. Its schema is applied and its Edge Functions are deployed. In that project's Auth URL Configuration, allow `circles://**` so email confirmation can return to the app. For a new project, apply [`supabase/setup.sql`](supabase/setup.sql) once through the Supabase SQL Editor. It creates the app schema, private media bucket, RLS policies, database transaction functions, indexes, 300 fixed-value gifts, and sample public circles. It also installs an auth-user trigger to create profiles and wallets. The SQL is a one-time bootstrap file rather than a repeatable migration; don't apply it a second time to an already initialized project. Later changes belong in [`supabase/migrations`](supabase/migrations).

### Local multi-user integration check

The integration harness creates and deletes five temporary users, circles, a post, a live room, and gift ledger entries. It refuses non-local Supabase URLs unless `CIRCLES_E2E_ALLOW_REMOTE=true` is explicitly set. Use a disposable local Supabase stack; do not point it at production.

1. Install and start the Supabase CLI with Docker, then apply `supabase/setup.sql` once to the local database.
2. Set `CIRCLES_E2E_URL`, `CIRCLES_E2E_ANON_KEY`, and `CIRCLES_E2E_SERVICE_ROLE_KEY` from the local stack output.
3. Run `pnpm e2e:local`.

The check covers own-profile edits and profile RLS, follower/following lists, accurate membership counts, public circle join/leave/rejoin, private request/cancel/approval/leave, owner-leave protection, post creation and private media access, rejection of one-way DMs, mutual-follow inbox and sending, read receipts, revoking conversation/history access after an unfollow, blocking a follower and rejecting a new follow, host-only live heartbeats, the three-co-host cap, gift retry idempotency, and wallet row isolation. It cleans up all created accounts and fixtures even if a check fails. Set `CIRCLES_E2E_STREAM_FUNCTIONS=true` when the local `issue-stream-token` function is running to include private-room and stale-session token rejection checks.

The current project already has both Edge Functions deployed. To deploy them to another project, run from the repository root:

```sh
supabase functions deploy issue-stream-token
supabase functions deploy verify-coin-purchase
```

Set these Edge Function secrets in the Supabase project:

| Secret | Purpose |
| --- | --- |
| `AGORA_APP_ID` | Server-side Agora token generation |
| `AGORA_APP_CERTIFICATE` | Signs short-lived Agora channel tokens |
| `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_BUNDLE_ID`, `APPLE_APP_ID` | Verifies signed App Store Server transactions (`APPLE_APP_ID` is the numeric App Store Connect app ID) |
| `ANDROID_PACKAGE_NAME`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Verifies Google Play purchases |

Supabase provides the function runtime URL and service credentials. Keep service-role keys and store credentials on the server; never add them to Expo `EXPO_PUBLIC_*` variables.

The client uses Supabase Auth, Postgres, Storage, and Realtime. Private post media is stored in a private bucket and displayed through short-lived signed URLs. The SQL constrains table access with RLS, while seat management, live gifts, circle membership requests, and verified coin credits use database functions. The stream-token function checks the user's role, room status, circle access, and co-host seat before issuing a short-lived token.

## Purchases and streaming

Create consumable in-app products with these product identifiers in both stores and set their prices in App Store Connect / Google Play Console:

| Product ID | Coins |
| --- | ---: |
| `com.circles.coins.120` | 120 |
| `com.circles.coins.700` | 700 |
| `com.circles.coins.1600` | 1,600 |

The UI prices are illustrative fallbacks; the native store's localized product price is used when available. The purchase buttons stay disabled until the store lists the products and the server reports that the platform verification credentials are configured. The wallet now shows the exact missing server secret names returned by the readiness check. The server verifies Apple transaction signatures against pinned Apple root certificates or checks Google Play before crediting the user's coin ledger. To enable real purchases, create all three products in both store consoles and set the Apple/Google secrets above. Coin packs are consumable; store restore is not a way to re-credit already consumed packs. Coin balances remain attached to the account. Creator cash-out is not part of v1.

The `preview.html` file is an interactive visual prototype with local demo data. It does not sign users in, create real posts/messages, start Agora streams, send ledger-backed gifts, or charge a store account. Preview actions are labeled as local simulations. Use the Expo iOS/Android development build for connected app flows.

Set `EXPO_PUBLIC_AGORA_APP_ID` in the app build environment and the matching Agora App ID and certificate in Supabase secrets. `StreamingAdapter` keeps app screens provider-neutral while `AgoraProvider` supplies credentials and a native Agora adapter for live rooms.

## Included flows

- Discover circles by interest; join and leave public circles, request or cancel access to private ones, and leave private circles after approval. Membership counts track actual member rows. Owners approve or decline pending requests. Circle owners cannot leave until ownership is transferred.
- Edit your display name, bio, and interests. Your profile lists the people following you and the people you follow.
- Open member profiles from Explore or from follower/following lists. Profiles show interests, visible circle posts, follower/following lists, follow controls, and a message action for mutual follows.
- Create circle posts with text, images, GIFs, and video. Media is uploaded to the private Supabase Storage bucket.
- Start a live room, join as a viewer, request a co-host seat, or accept/decline a request as host. The server enforces a maximum of four seats total (host plus three co-hosts).
- Send catalog gifts from a coin wallet. The catalog is seeded with 300 fixed-value gifts; wallet changes and gift events are handled atomically and are idempotent.
- Send direct messages only while both accounts follow each other. Database policies and the send function re-check this rule on every send/read, including after a follow is removed.
- Report profiles, circles, posts, messages, and live rooms; block users.

## Verification status

Run `pnpm test:db` for isolated PostgreSQL regression tests covering DM edit permissions, blocking, media drafts and cleanup, host heartbeats, public/private circle exits, and service-only idempotent purchase credits. The tests execute the real bootstrap and corrective migration using PGlite, including Supabase-style default table grants. They require no credentials and do not contact a Supabase project. Auth and Storage schema primitives are test fixtures; HTTP services, Realtime delivery, cron scheduling, and native SDKs require integration testing. To validate an upgrade from a saved older bootstrap, set `CIRCLES_TEST_BASELINE_SQL` to that SQL file before running the tests.

Existing projects need `supabase/migrations/20261012135221_fix_core_flow_authorization.sql`; fresh projects use the updated `supabase/setup.sql`. The app now refreshes home and circle feeds when media drafts are published. The `pnpm e2e:local` harness also checks these database fixes through Supabase Auth, REST, and Storage APIs on a disposable project.

The connected Supabase project has the schema, RLS, private media bucket, 300 active gifts, and both Edge Functions deployed. Host live rooms send heartbeats, and a scheduled database job closes stale sessions. Circle member counts were reconciled to membership rows. The Agora App ID and certificate are set as server-side Edge Function secrets, and `circles://**` is allowlisted for email confirmation callbacks. The local multi-user integration harness is available as `pnpm e2e:local`; it requires a disposable local Supabase stack and was not run against production. To enable real coin purchases, create the listed store products and set Apple/Google verification secrets. Native livestream and store transaction testing still requires installed native dependencies, development builds, physical devices or working simulators, and store sandbox accounts.
