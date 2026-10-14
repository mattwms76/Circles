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
5. `supabase/migrations/20261012163503_experience_enhancements.sql`
6. `supabase/migrations/20261012164050_experience_policy_consolidation.sql`
7. `supabase/migrations/20261013063428_replies_audit_hardening.sql`

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

- `pnpm check`: TypeScript and credential-free regression tests. There are currently 92 passing checks, including React component tests for repeated sign-in events, navigation during requests, account isolation, immediate chat-draft persistence, failed stream setup cleanup, demo state/media consistency, and profile photo selection, cancellation, upload retry, and account isolation. The component harness runs the actual app code with mocked native SDK and network boundaries; it does not replace device testing. PGlite executes the real SQL with Supabase-style grants and Auth/Storage schema fixtures. Tests cover both the previous six fixes and the new community, moderation, push queue, idempotency, and deletion permissions.
- `pnpm export:android` and `pnpm export:ios`: bundle the native JavaScript to catch module and compilation problems. These are not native device builds.
- `pnpm e2e:local`: creates and cleans up temporary accounts and fixtures in a **disposable local** Supabase stack. It checks Auth, REST, Storage, circle membership, DMs, live seats, gifts, onboarding, discovery, events, notification privacy, and moderation. It refuses non-local URLs unless explicitly overridden; never run it against the production project.
- `.github/workflows/checks.yml`: runs static/database checks and both bundle exports, then boots a disposable Supabase Docker stack, applies the complete seven-file bootstrap sequence, serves functions, waits for the account endpoint to return its expected method response, and runs API integration tests. It keeps historical migration files outside the startup directory because they are not a from-zero chain.

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


## Experience enhancements (12 October 2026)

All seven experience areas are implemented in the native app with interactive local equivalents in `preview.html`:

1. Shared spacing, typography, accessible contrast and touch targets, labelled fields, consistent button states, scrolling sheets and a scrolling gift drawer.
2. Three-step onboarding across selected interests, relevant circles, people to follow, and a first introduction. Private requests explain the approval step.
3. Discovery combines interest, privacy and recent activity with personalised, newest and popular ordering, recommendation reasons, reset controls and empty states.
4. Direct-message and comment replies and reactions; conversation search and unread navigation; account-scoped draft storage; the server-enforced 15-minute deletion window with a live countdown. Failed sends preserve drafts.
5. Circle overview and editable rules, member roles, owner-managed moderator assignments, events and RSVP. Circle moderators can organise events; global moderation remains separately authorised.
6. Scheduled live rooms, edits/cancellation, opt-in reminders, host-only start, live connection status, gift categories/search/favourites and coin prices. Reminder records and queued deliveries are removed when plans change or a member unsubscribes.
7. Activity grouped by destination and day, explicit unread labels and filters, direct content navigation, circle notification preferences and conversation muting.

Database migrations `20261012163503_experience_enhancements.sql` and `20261012164050_experience_policy_consolidation.sql` are deployed to the connected Circles project. Reaction tables are included in Realtime. The existing minute scheduler creates upcoming-room reminders in the in-app activity inbox. Device push remains subject to the existing dispatcher approval and EAS/APNs/FCM setup described above; this change does not activate external push delivery.

Verification includes TypeScript, 65 regression checks, Android and iOS bundle exports, browser flow checks, and a 320-pixel layout check. New SQL regressions cover private replies/reactions, owner-only roles, moderator events, private scheduled rooms, reminder deduplication, rescheduling, unsubscribe cleanup and delivery eligibility. Database advisors report no security or performance warnings from these changes; informational notices remain for deliberately server-only tables and unused indexes. Native camera/audio, store transactions and real device push still require the device checks above. No changes have been pushed to GitHub.


## Replies and comments audit (13 October 2026)

The audit found and fixed late sends affecting another thread/account, reopened drafts being cleared by a previous send, stale refreshes removing new comments, a silent 200-comment limit, misleading empty states after loading errors, stale reaction requests, and reaction counts truncated by the API row limit. Replies now load newest-first from the server and display chronologically, with an explicit control to load earlier replies. The preview rejects blank submissions, preserves line breaks and clears deleted reply references.

The local regression suite now has 82 passing tests. Targeted checks include 251-comment threads, 1,203 reactions, send failures and repeated taps, account changes, parent deletion, private-circle membership, forged authors, cross-post replies, deletion expiry, reaction races and draft preservation. TypeScript and Android/iOS bundle exports pass. Browser checks cover draft restoration, quoted replies, multiline/HTML-like text rendering, reaction persistence, blank-send prevention and cancelling deletion. The SQL checks use isolated PostgreSQL/PGlite with the actual schema and migrations; native component tests mock transport and native SDK boundaries.

**Deployed and verified (13 October 2026):** `supabase/migrations/20261013063428_replies_audit_hardening.sql` adds direct-comment-author notifications and rejects whitespace-only comments at the database boundary. It was committed to the connected project over a certificate-verified PostgreSQL connection after transactional live checks passed. Checks covered normalization, blank/oversized bodies, private membership, forged authors, cross-post replies, recipient notifications, parent/reaction cleanup, notification deletion, author-only deletion, and the 15-minute deadline. Temporary test records were rolled back before the schema migration was committed; a subsequent read confirmed the migration and restricted function grants. Database access does not restore the Codex Supabase connector or configure the native app. Real-device, two-account Realtime and external push delivery still require integration testing. No changes were pushed to GitHub.

## Full app audit (13 October 2026)

Three additional problems were reproduced or confirmed and fixed:

- Old Explore pagination requests could keep a new query busy, report stale errors, or stop its loading indicator. Query generations now guard both failure and completion paths; a new query resets pagination state.
- A direct message completing after closing a chat could erase a newer saved draft after reopening it. Message and comment drafts now share ordered storage writes and per-draft edit versions; late sends cannot clear newer text.
- The CI integration database stopped at the community migrations. Its bootstrap now includes content deletion, experience enhancements, policy consolidation, and reply hardening, matching fresh-install instructions.

Validation: 85 automated tests pass, including three new race regressions that failed before the fixes. TypeScript and Android/iOS JavaScript exports pass. The browser prototype was checked for profile editing/cancellation, notification preferences, conversation search, disabled blank sends, required schedule fields, live-room navigation and gift searching. It produced no browser console errors during these checks. These browser results cover simulated local data, not native SDKs or authenticated server transport.

Live database inspection confirmed the latest migration, RLS on all 33 public tables, configured search paths on privileged public/private functions, client-inaccessible audit trigger functions, private post media/public avatars, expected Realtime tables, and active cleanup/reminder jobs. This was a catalog inspection and targeted transactional verification, not a new Supabase advisor run or an exhaustive proof of every policy.

The native Supabase URL and supplied publishable key are now configured in ignored `.env.local`. The project Auth settings and REST endpoints both accepted the key (HTTP 200), and configured Android/iOS bundle exports pass. This enables the real sign-in/backend path; it does not verify an authenticated user session or reconnect the Codex Supabase plugin. The browser prototype continues to use local demo data. The database password is administrative access and must never be used by the mobile app. Remaining release blockers include the Agora App ID and EAS project ID, which are not configured locally. Docker and native devices are unavailable here, so the full Auth/REST/Storage integration job, camera/audio and reconnection, push delivery, recovery links, actual account deletion, and Apple/Google sandbox purchases still require execution. The push dispatcher remains pending configuration/deployment. A passing bundle export is not a signed native build or a device acceptance test.


## Code maintenance (13 October 2026)

Message and comment composers use `src/lib/textDraftStore.ts` for ordered writes, restoration after pending writes, and edit versions that protect newer drafts from late send completions. The storage adapter is injected so persistence failures and account-key isolation can be tested without a device. Coin catalogue failures are now caught, reported, and retryable.

Unused discovery state, imports and refs were removed. TypeScript now checks `noUnusedLocals` and `noUnusedParameters` as part of the normal typecheck. Application source and test scripts follow `.prettierrc.json`; format them with `pnpm dlx prettier@3.6.2 --write App.tsx src scripts`. No runtime dependency was added for formatting.

Verification: 88 tests pass, strict TypeScript passes, and configured Android/iOS bundle exports pass. The new tests exercise ordered draft restoration, recovery after storage failure, account isolation, and store catalogue retry. Existing device/integration release checks above remain outstanding.


## Record and post circle videos

Open a circle you belong to and choose **Share a thought**, or open the main composer and select a joined circle. Choose **Record video** to use the phone camera, or **Upload video** to select an existing clip. Recordings can be previewed and removed before posting. Video-only posts and optional captions use the existing private-media upload, progress/cancel/retry controls, saved drafts, and circle timeline playback. The limits remain two minutes and 25 MB. Camera denial and recording cancellation leave the draft intact; a recording completed after an account change is ignored. Posting still checks current circle membership on the client and through database/storage policies.

The mobile app uses the installed Expo image-picker camera API and existing camera/microphone permissions. The browser prototype offers the corresponding video file input with a capture hint on supported phones; it remains a local simulation, and desktop browsers may show a file chooser instead of a recorder. Actual recording and audio must be verified on iOS and Android devices; camera SDK calls are mocked in automated tests.

Verification: 92 automated tests, TypeScript and both configured mobile bundle exports pass. New regression tests cover recording and submitting to the selected circle, permission denial, cancellation, account switching, and recording size/duration limits.


### Design refresh (14 October 2026)

The native app and browser prototype now use a compact Home greeting, an activity bell with unread count, compact live/circle shortcuts and an earlier timeline. Circle pages have an image identity and separate Posts, Events and About tabs; membership, rules, notifications and owner/moderator tools remain available in their relevant sections.

Shared typography and spacing are more restrained. Primary actions retain terracotta emphasis while secondary controls use quieter surfaces and consistent icons. The posting sheet has an aligned media toolbar, large playable attachment previews, replace/remove controls, upload progress and a publish footer outside the scroll area. Empty posts cannot be submitted. Comments and messages show existing reactions with an expandable picker and a contextual Reply/Delete menu; the existing 15-minute deletion rules still apply.

Colours follow the device's light/dark appearance without resetting drafts. Sheets respect Reduce Motion, text retains native font scaling, and the browser supports narrow screens, keyboard dialog navigation and a System/Light/Dark preview selector. Loading, empty, error and success feedback uses the shared palette. The prototype notice is outside the simulated phone.

`expo-system-ui` and the automatic appearance configuration require a rebuilt development client/native app. JavaScript exports do not install those native changes on a phone. Physical-device keyboard, camera and large-text checks remain a release QA step. The browser uses simulated local data and is not a substitute for those checks.

Validation: 96 automated tests, strict TypeScript and Android/iOS JavaScript exports. New UI regressions cover tab isolation, the fixed composer footer, reaction selection, reduced motion, and theme changes preserving component state.


### Audit enhancements (14 October 2026)

Explore now opens with collapsed advanced filters, an active-filter count and circles before people. The preview selected-filter contrast is corrected for dark mode. Native and preview palettes come from `src/design-tokens.json`; run `pnpm tokens:sync` after changing colours. `pnpm tokens:check` prevents palette drift in CI. Home/Explore, loading states, post controls, video playback, circle search and scheduling are separated into feature modules.

Post options include owner-only editing and soft deletion at any time while membership permits. Deletion removes the post from the timeline rather than purging stored records. Comment and direct-message deletion still has its existing 15-minute limit. Saved posts are private per account and sync through `post_bookmarks`; inaccessible/removed posts are omitted from the saved view. Apply `supabase/migrations/20261014130512_post_bookmarks.sql` before using connected bookmarks. **Deployed on 14 October 2026 after explicit approval.** Ownership and private-circle access were verified on the connected database using synthetic records rolled back after the checks.

Sharing produces `circles://post/<id>?circle=<circle-id>` and `circles://circle/<id>` links. The installed app retains content intent through sign-in, checks current access, and opens the circle join flow if necessary. These are installed-app scheme links, not hosted universal links or an app-store fallback. Post text is not included when sharing private content. Circle posts support server-side text search and photo/video filters with pagination and stale-request protection.

Uploads now use TUS in 6 MB chunks with bounded network retries and persistent per-account resume information. Cancel pauses the transfer and keeps the existing draft; Retry resumes within the storage upload session lifetime. Completed files are retained when a metadata/publish response is lost. Playback creates a thumbnail, pauses offscreen/background video, renews a private URL once after playback error and offers manual retry. Native upload and media-player behaviour still requires device/network acceptance testing; the browser remains a local prototype.

Events and live-room schedules use native date/time selection, a timezone-aware confirmation display, existing future-date validation and an OS Add to calendar form. The preview uses browser date/time fields and calendar downloads. Rebuild the native client for the new date-picker, calendar and image modules.

Run `pnpm check` for palette consistency, TypeScript and automated regression tests. `pnpm test:visual` runs preview layout/contrast and save/edit interaction checks, capturing light/dark screenshots; CI installs Chromium and retains reports. `.maestro/discovery.yaml` and `.maestro/post-controls.yaml` provide device smoke flows. Run them against a disposable test account (or a demo build) on both platforms, in light and dark appearance, preserving screenshots as release evidence. They are supplied but have not been run on physical devices here.

Run `pnpm release:check` before preparing a release. Add `EXPO_PUBLIC_AGORA_APP_ID`, `EXPO_PUBLIC_EAS_PROJECT_ID` and `EXPO_PUBLIC_SUPPORT_EMAIL` to the ignored `.env.local` when available. `app.config.ts` maps the EAS project ID into Expo configuration. No placeholder IDs were inserted. Verify APNs/FCM credentials, notification-dispatcher deployment/scheduling, real two-account flows, interruption/resume, Agora sessions and store sandbox purchases separately. Passing exports is not native/device certification.

Validation for this enhancement pass: 105 automated tests pass, strict TypeScript and shared-token checks pass, and both final Android/iOS bundle exports pass. Browser verification covered dark-mode contrast (15.6:1 for the selected filter), a 390 px viewport without horizontal overflow, filtering, saving/unsaving, author editing and circle search. The new Playwright CI job and Maestro device flows are authored but were not executed here. The Supabase bookmark migration was subsequently deployed after explicit approval; connected-database ownership and private-circle checks passed, and synthetic test data was rolled back.
