# Activity Inbox v1

## Member experience

Signed-in members can open **Updates** from the app shell's bell or wide navigation. This is separate from Messages and does not add a mobile bottom tab. The inbox shows newest-first updates when someone else comments on the member's post or a moderator/owner approves the member's pending circle request. It starts with future events only; historical comments and approvals are not backfilled.

Rows expose the actor's current public profile name, action, circle and time only when the recipient still has access. Deleted or revoked targets become generic unavailable rows with no actor/circle copy or destination. Opening a destination calls a fresh protected resolver; a post uses the existing PostCard, and an approval opens a still-authorized circle. Rendering, visiting or resolving an update does not silently mark it read. Explicit individual read actions—including unavailable items—and **Mark all read** update durable recipient-only state. The badge is derived from the same unread records, with `99+` display capping. Mark-all uses the last server-returned watermark so later arrivals remain unread.

**Update preferences** lets a member enable or disable either category. A circle's About area exposes a desired-state mute switch for the current member, including a pending requester. These settings apply to future event creation; they do not delete existing inbox items. Circle activity requires current approved membership before its content/destination is exposed, even when the circle is public. Global posts use current post access. Guest, loading, empty, error, retry and pending controls do not display stale account content.

## Server and private persistence

`shared/activity.ts` defines the bounded contract; `server/activity-router.ts`, `activity-service.ts` and `activity-events.ts` implement the protected APIs, recipient isolation, source transaction hooks and preference serialization. Events are inserted atomically with actual authorized new comments or pending-to-approved transitions. Self-events are suppressed. A recipient/kind/source unique key suppresses retries of the same event. Stored event data is IDs, a kind and timestamps—not comment bodies, messages, circle text, device tokens or provider credentials.

Private `circles_app` tables are `activityItems`, `activityPreferences` and `activityCirclePreferences`. The three tables have backend-only forced RLS policies and restricted runtime grants; they intentionally extend the active application inventory from 22 to 25 tables and add one identity sequence. The archived MySQL import manifest remains historical. `0010_circles_activity_inbox.sql` creates the feature; `0011_circles_ops_activity_health.sql` extends the existing exact health inventory without replacing or rescheduling Cron job 7. Recovery, current-schema auditing, API readiness, isolated fixtures and the separate private encrypted-backup restore contract must agree on this inventory.

Protected reads are `activity.list`, `activity.unreadCount`, `activity.preferences` and `activity.resolveTarget`. Writes are `activity.markRead`, `activity.markAllRead`, `activity.updateCategories` and `activity.setCircleMuted`. Optional `viewerScope` rejects stale cache affinity; it never supplies identity. Paging is bounded descending-ID keyset pagination (20 by default, at most 40). Read-all requires an explicit captured nonnegative watermark. Partial category updates preserve the other desired state.

## Validation and limits

Run `pnpm test:e2e:activity` on the supported Linux PG17/Node22.23.4 test toolchain; see [the isolated test guide](activity-e2e.md). Tests exercise real local HTTP, router, service, transactions and restricted-role PostgreSQL against synthetic owned fixtures. The fixture identity header is test-only: these tests do not prove real OAuth/session handling, rendered authenticated UI, signed iOS/Android behavior or native push. They never use Supabase or production account fixtures.

Native push, email/SMS, mentions, likes, DM duplication, quiet hours, digest scheduling, live sockets, device-token storage and a paid notification provider are intentionally outside v1. The in-app badge refreshes through normal query mount/focus and explicit inbox mutation invalidation, not a claimed realtime delivery SLA. Existing owner/provider/relay/recovery and security prerequisites remain separate. Publication remains disabled.

Activation, actual migration metadata and exact-source CI results are recorded only after observed validation; implementation alone is not release/native proof.

## Rollout evidence — 23 October 2026

The reviewed additive Activity Inbox migration is applied to the existing private schema. All three new tables enforce RLS and backend-only policies; API-facing Supabase roles have no table access. The application now has 25 private tables. The existing daily health check is healthy and Cron 7 remains active at 03:15 UTC without schedule changes. API and same-origin Preview readiness pass; guests are denied all four new read procedures.

The isolated real HTTP/PostgreSQL17 Activity suite passes 12 scenarios and the existing Circle Home suite passes 8. Disposable fixtures are removed. The complete credential-free TypeScript/lint/unit/auditor/environment/API/workflow checks and the actual recovery-manifest regression pass. These use synthetic test context identities, not provider OAuth, rendered authenticated screens or signed native devices.

Encrypted private-backup run `39978009949` successfully validates 25 application tables plus `circles_ops.health_runs`. Its actual private Release was downloaded and verified for immutable source provenance, asset digests, owner-key decryption and inner dump/role checksums, then temporary plaintext was removed. Existing backup schedules and 30-day managed-release retention are unchanged. No provider-managed full restore or production restore is claimed. Exact saved-source app CI/container evidence will be recorded after those automatic runs finish.
