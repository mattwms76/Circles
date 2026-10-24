# App / admin shared-behaviour parity

## Scope

The owner requested matching shared data, permissions and behaviour while keeping Circles-Admin separate. The mobile app does not acquire an operator console, administrative credentials, global analytics, Team/Audit access or broader private-data permissions.

This work compares app source `07b869eab78b18b3cbc8366ab4089beac48987d0` with admin source `b1d81cc42e0784ab7c942a63eab0a8ef04c079c1`. The admin task owns its newer authentication and panel fixes; its unpublished work is not part of this pinned baseline.

## App changes

- Shared invalidation covers both legacy and paginated profile, feed and circle-directory queries after member mutations. Report/delete also refresh moderation queue/detail; source refresh reconciles optimistic engagement state without adopting a previous account’s completion.
- Source revalidation runs only in foreground with active observers and current route/resource/viewer scope. It refreshes on relevant lifecycle/route events and at a bounded 15-second interval; this is eventual source reconciliation, not a realtime administrative event channel.
- A moderation decision conflict refreshes current case/queue before releasing controls, preserves a recoverable reviewer draft, and retains authority-loss/account safeguards.
- Discover Posts uses bounded source-backed search (trimmed, at most 120 characters, literal wildcard handling) with existing private-circle eligibility and compound pagination. Changing search selects a fresh infinite-query key.
- Circle-only reporting is explicit in both UI and service. Unsupported global reports are rejected before writes rather than acknowledged as actionable reviews. No global moderation model is introduced.
- Minimal `platform.status` and an optional server-only feature reader prepare shared setting behaviour; the informational maintenance notice does not replace navigation or end current streams.

Private-circle discovery teasers remain intentionally discoverable for join/application/cancel flows. This does not expose private Home/rules/pinned content, posts or member rows. A restrictive operator directory is not evidence that the sanctioned member teaser is a content-access defect.

## Prepared feature contract — not activated

`circles_admin.read_mobile_feature_settings()` must return exactly:

```ts
{
  registrationsOpen: boolean;
  circleCreationEnabled: boolean;
  liveStreamingEnabled: boolean;
  maintenanceMode: boolean;
  maxUploadMb: number; // integer 1–20
}
```

The separate admin task prepares a sealed fixed-search-path function and seeded singleton, with a shared settings-row lock held during guarded source transactions. Only an explicitly approved restricted application runtime grant may make it callable; no raw control-plane tables, admin credentials or operator/session/audit fields are exposed. `reportThreshold` is excluded because its enforcement semantics have not been approved.

`CIRCLES_PLATFORM_SETTINGS_ENABLED` is server-only and defaults off. Inactive mode reports `integration: inactive`, `feature_readiness: false`, `settings: null` and preserves current application behaviour. When explicitly enabled after approval, missing, malformed or unavailable settings fail closed for guarded admissions. Decisions are not accepted from clients and authoritative reads are uncached.

Registration gating applies only to the first source-user insert after provider identity validation; existing-user sign-in remains valid. Circle creation is checked before source writes. New live creation is checked before relay/lease work and again in its source transaction; existing live streams, viewers, chat, signaling and ending remain unchanged. Upload admission retains the 20 MiB hard cap and enforces a lower effective limit before encryption/storage writes. Maintenance is presentation-only, not a guessed global write suspension. UI status and picker metadata are advisory; the backend is authoritative.

Live panel setting edits remain rejected until both the restricted reader and opted-in app deployment are approved/provisioned and verified. This app task does not activate the switch or apply production SQL/grants/credentials/settings.

## Panel coordination

The active admin task accepted panel fixes for role-safe snapshots, legacy non-source stream-action rejection, force-end lock ordering, pending-member/current-live projections, linked operator and Team/Audit reachability, stronger readiness, public-media policy alignment, truthful retained-record analytics and unimplemented report-threshold treatment. That task preserves its concurrent Supabase authentication/MFA work and original Manus-linked source identities. Its final saved source and checks must be recorded before those changes are treated as delivered.

Accepted panel source is `3839f3850b115eb9da4792ede309c7e4b944b5e4`; later `bae85eb` adds delivery evidence only. The panel task reports 134 passing unit/type/build checks and disposable PostgreSQL rehearsals (12 control-plane, 14 native-operation, 11 auth/RLS, 3 reader checks). Its exact optional reader SQL and contract were inspected in a separate read-only worktree and match the prepared app DTO. These are synthetic/source checks, not live activation or real-account proof. Five live feature edits remain backend-rejected and UI-disabled; the optional reader is excluded from the pending auth installation approval.

## Verification and remaining gates

Integrated credential-free validation passed: 557 unit/regression tests in111 files, tracked-source formatting, strict TypeScript-unused, zero-warning lint, database-audit/template checks, API build and isolated Circle Home8, Activity12 and Moderation7 HTTP/PostgreSQL17 tests. All confirmed integration issues were corrected: maintenance-only semantics, the three additional join/follow invalidation paths, per-identity first-registration serialization and hook-safe scoped optimism. Existing verifier fixtures now cover exactly 30 source queries rather than hiding the new status query.

Accepted app source is canonical `a58e83d4a390343a397a6a309374292f9e972941`, GitHub `dfe7f25e99b06bf91c8620a6d6d8244d8bdbca0b`, matching tree `6af896b30a548dc5535a1c2daa250a1a24b9f420`. Exact-source CI [40087349213](https://github.com/mattwms76/Circles/actions/runs/40087349213) passed all four jobs, all three isolated HTTP/PostgreSQL suites and Android/iOS/web JavaScript exports. Container validation [40087349199](https://github.com/mattwms76/Circles/actions/runs/40087349199) passed. This closure changes documentation only, not the tested application source.

After trusted environment synchronization and a fresh restricted read-only connection preflight, only the stale API was reloaded. Metro was preserved. API3000 and same-origin Metro8081 both return ready200/database=true and the exact public platform status `integration: inactive`, `feature_readiness: false`, `settings: null`. No reader was provisioned, switch enabled, production record/schema/RLS/schedule altered, secret rotated or app published. These checks are not signed-native, real-account or active-control-plane evidence.

Full **live** cross-product parity still requires separately approved control-plane provisioning and function/grant installation, the restricted application reader and opted-in deployments, a linked approved operator, correct origin and real-account/session/native-action verification. Actual native foreground/rendering/assistive-technology journeys remain distinct from unit tests and JavaScript exports. Durable historical analytics and global moderation require their own approved contracts; existing privacy/cascade/session behaviour is not weakened to fabricate parity.
