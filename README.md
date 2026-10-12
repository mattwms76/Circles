# Circles

Circles is an Expo / React Native iOS and Android community app backed by Supabase. It supports interest-based circles, posts and media, mutual-follow messages, live rooms, co-host seats, gifts, and moderation. Without Supabase configuration it opens with demo data.

## Run the native app

1. Install Node.js 24+ and pnpm, then run `pnpm install --frozen-lockfile`.
2. Copy `.env.example` to `.env.local` and set the Supabase URL, publishable key, and Agora App ID.
3. Build with `pnpm android` or `pnpm ios`, or use an EAS development build. Rebuild after this update: notifications and file uploads include native modules. Expo Go is not supported because Agora and in-app purchases require a development build.
4. Start Metro with `pnpm start` and open the installed build. iOS requires macOS and deployment target 16.4 or newer.

`preview.html` is a separate browser prototype using simulated local data. It does not exercise the connected native app, and its Explore filters and result count are checked separately from the native flows.

## The seven improvements

| Area | Implemented behavior |
| --- | --- |
| Consistency | Member profile posts have their own query and pagination. Likes update across open feeds with rollback on failure. Live discovery uses Realtime, foreground refresh, and polling. Co-host departure releases a seat, with server expiry for abandoned seats. |
| Onboarding | Name, public profile photo, interests, suggested circles, and first-circle joining. Empty feeds explain the next action. Moderator metrics show registration, onboarding, joining, and contribution for the last 30 days. |
| Discovery | Circle and people search run on the server before pagination. Circles have interest filters and shared-interest recommendations; blocked people are excluded. |
| Everyday use | Pull to refresh, loading placeholders, account-scoped post and message drafts, retained attachment files, upload progress, cancellation, retry keys, readable wallet errors, improved contrast, labels, and touch targets. |
| Community activity | Private activity inbox for messages, replies, approvals, followed hosts, and events. Notification categories, circle mutes, quiet hours, pinned welcome text, scheduled events, RSVPs, and deduplicated reminders. Device-push worker is implemented but deployment remains pending approval. |
| Account and moderation | Password-reset links, account deletion with password confirmation, blocked-member management, report reasons, and a server-authorized moderator queue with reported-media previews, removal, audit records, and protection against republishing removed posts. |
| Reliability | Virtualized feeds and chat, batched/cached signed media URLs, an error boundary, opt-in technical diagnostics, PostgreSQL regressions, API integration checks, and GitHub Actions. |

## Deleting messages and comments

Authors can delete their own direct messages and comments for 15 minutes after sending. Tap **Delete** beneath the item and confirm the deletion. The control expires while the screen is open; PostgreSQL independently enforces the author and deadline using server-owned timestamps. Deletion removes the item, associated activity notification, and queued push delivery. Already delivered device notifications cannot be recalled. Realtime deletes update open conversations and replies, and failures leave the content available for retry. The browser prototype has the same controls for its local demo data.

## Database and functions

The connected Supabase project has the community schema and account-deletion function deployed. Existing streaming and purchase functions remain deployed. The push dispatcher is **not deployed or connected to its scheduler endpoint**, pending approval for Expo push delivery. The scheduled database job still creates in-app event reminders without making an external request.

For a **fresh project**, apply these files once, in this order:

1. `supabase/setup.sql`
2. `supabase/migrations/20261012145107_community_experience.sql`
3. `supabase/migrations/20261012145255_community_foreign_key_indexes.sql`
4. `supabase/migrations/20261012155424_content_deletion_window.sql`

`setup.sql` is a one-time bootstrap, not a repeatable migration. Historical files in `supabase/migrations` describe upgrades to older bootstraps; they are not a complete from-zero migration chain. Do not run all historical files after the current bootstrap. Existing initialized installations need the applicable upgrades, including `20261012135221_fix_core_flow_authorization.sql` if it has not already been applied, then the two community migrations and the content-deletion migration above.

Allow `circles://**` in Supabase Auth URL Configuration. Recovery emails return to `circles://auth/recovery`; verify this on an installed native build.

The functions are `issue-stream-token`, `verify-coin-purchase`, `delete-account`, and the pending `dispatch-notifications`. Normal user functions require JWT verification and validate the user or operation internally. The dispatcher uses a random database-owned secret and service-only RPCs; it accepts only POST requests with that secret. No client receives it. Notification delivery rows, moderation audit records, and runtime settings deliberately have no client RLS policies.

Account deletion revokes sessions, transfers owned circles to the longest-standing remaining member (or removes empty circles), removes the profile and dependent records, removes uploaded media, then deletes the Auth identity. Failed server cleanup is retryable. Successful deletion also clears the account's local drafts and pending gift keys. Profile photos can be changed from **You → Change photo** or **Edit profile**, previewed, then saved with the profile. JPG, PNG, and WebP images up to 5 MB are supported. The browser prototype saves a resized photo locally in that browser. Public avatars are disclosed as public in onboarding and the profile editor; post media stays private behind signed URLs.

### Remaining configuration

| Setting | Purpose |
| --- | --- |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | EAS project UUID needed to register device push tokens. Also configure APNs / FCM credentials for the native builds. |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | Optional Contact support link in Settings. |
| `EXPO_PUBLIC_AGORA_APP_ID` | Native video configuration; must match the server App ID. |
| `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` | Server-only Agora token generation. |
| `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_BUNDLE_ID`, `APPLE_APP_ID` | Server-only App Store transaction verification. `APPLE_APP_ID` is the numeric App Store Connect app ID. |
| `ANDROID_PACKAGE_NAME`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Server-only Play purchase verification. |
| `EXPO_ACCESS_TOKEN` | Server-only token if Expo enhanced push security is enabled; needed only when activating the dispatcher. |

Never put service-role keys, store credentials, or scheduler secrets in `EXPO_PUBLIC_*` variables.

A project operator must explicitly assign a real member to `public.moderators` using trusted server access. Membership in that table, rather than editable user metadata, authorizes moderation. No account was automatically promoted. The moderator workspace is available from Settings once assigned.

Device push is opt-in and separate from the in-app inbox. The pending worker sends Expo device tokens, generic notification text, and a notification ID to Expo; it does not send message bodies or post content. Jobs respect blocks, current device ownership, preferences, circle access, quiet hours, and expired events/rooms. Deliveries have bounded retries and receipt checks. Equal quiet-hour start/end disables the quiet interval. Its external endpoint remains unset until deployment is authorized and complete.

Technical diagnostics are also opt-in. They store bounded error codes and scrubbed JavaScript stack frames, not message or post text, and are deleted with the account. This is application-level error reporting, not a native crash-reporting SDK.

## Purchases and streaming

Create consumable products `com.circles.coins.120`, `com.circles.coins.700`, and `com.circles.coins.1600` in both stores. Configure their prices and the verification secrets above. Purchase buttons remain disabled until products and server verification are ready; the wallet uses localized store prices and friendly unavailable-state text. Credits are server-verified and idempotent. Consumable restore does not re-credit spent coins. Creator cash-out is outside v1.

Live rooms support a host plus up to three co-hosts. Host and co-host heartbeats keep active sessions/seats alive; scheduled jobs reclaim abandoned sessions and seats. Native permissions, reconnect behavior, and background behavior require device testing.

## Verification

- `pnpm check`: TypeScript and credential-free regression tests. There are currently 55 passing checks, including React component tests for repeated sign-in events, navigation during requests, account isolation, immediate chat-draft persistence, failed stream setup cleanup, demo state/media consistency, and profile photo selection, cancellation, upload retry, and account isolation. The component harness runs the actual app code with mocked native SDK and network boundaries; it does not replace device testing. PGlite executes the real SQL with Supabase-style grants and Auth/Storage schema fixtures. Tests cover both the previous six fixes and the new community, moderation, push queue, idempotency, and deletion permissions.
- `pnpm export:android` and `pnpm export:ios`: bundle the native JavaScript to catch module and compilation problems. These are not native device builds.
- `pnpm e2e:local`: creates and cleans up temporary accounts and fixtures in a **disposable local** Supabase stack. It checks Auth, REST, Storage, circle membership, DMs, live seats, gifts, onboarding, discovery, events, notification privacy, and moderation. It refuses non-local URLs unless explicitly overridden; never run it against the production project.
- `.github/workflows/checks.yml`: runs static/database checks and both bundle exports, then boots a disposable Supabase Docker stack, applies the three bootstrap files, serves functions, waits for the account endpoint to return its expected method response, and runs API integration tests. It keeps historical migration files outside the startup directory because they are not a from-zero chain.

For manual local integration, use the same empty-migrations startup and bootstrap procedure as the workflow. Set `CIRCLES_E2E_URL`, `CIRCLES_E2E_ANON_KEY`, and `CIRCLES_E2E_SERVICE_ROLE_KEY` from `supabase status -o env`. Set `CIRCLES_E2E_ACCOUNT_FUNCTIONS=true` when the deletion function is served; set `CIRCLES_E2E_STREAM_FUNCTIONS=true` when Agora token secrets and the stream function are available.

The database advisor reports no security warnings or missing foreign-key indexes. Remaining informational notices concern [deliberately policy-free internal tables](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [indexes awaiting production traffic](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), and the existing [Auth connection allocation setting](https://supabase.com/docs/guides/deployment/going-into-prod).

### Device release checklist

| Flow | Required device verification |
| --- | --- |
| Auth and onboarding | Sign-up confirmation, recovery deep link, avatar permissions, interest selection, suggested-circle joins, and account deletion. |
| Posting | Restart with a saved draft; background, cancel, and retry a video upload; verify one published post after a lost response. |
| Discovery and accessibility | Search beyond page one, rapid query changes, VoiceOver/TalkBack, large text, keyboard avoidance, and long-feed scrolling. |
| Community | Two-account replies, private-circle approval, event RSVP/reminder, quiet hours, block/unblock, moderator removal, and revoked media access. |
| Push | After authorized deployment and APNs/FCM setup, test foreground/background alerts, taps, sign-out, account switching, quiet hours, and expired tokens. |
| Live and wallet | Multiple devices joining/releasing seats, reconnects and background expiry; Apple/Google sandbox purchase, cancellation, and transaction retry. |

At implementation time, TypeScript, isolated regressions, both JavaScript bundle exports, and Deno function checks were run. The connected database's RLS, privileged-function grants, Realtime publication, and scheduled jobs were verified. Docker and native devices were unavailable, so the Docker/API workflow and the device checklist remain unexecuted. The push worker is awaiting deployment approval, and EAS/support details have not been supplied. Changes have not been pushed to GitHub.
