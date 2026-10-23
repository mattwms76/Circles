# Moderator Report Workspace v1

## Scope and entry

Circle owners and current moderators can open **Reports** from Circle Manage. The workspace has paginated Open and Resolved queues and a case detail with anonymous report counts/reasons, the currently authorized post when available, and a minimal review outcome. Ordinary/pending members, guests and moderators from another circle have no case access. The normal app login/session and private server-mediated PostgreSQL model remain authoritative.

## Decisions and privacy

A reviewer may deliberately **Keep** or **Remove** a reported circle post, optionally adding a moderator-only note of at most 500 Unicode code points. Removing a post requires confirmation; it uses the application's existing authorized post-deletion behavior and does not prove physical object-storage erasure. A missing/deleted post renders as unavailable without reconstructing its text or media.

A reviewer cannot resolve a case concerning their own post. Another eligible circle reviewer must handle it; there is no invented staff override. Final decisions are not automatically reopened by subsequent reports. Later reports may update anonymous aggregates, but cannot erase or replace the prior decision, note or review action. Repeating the exact same desired resolution is safe; a conflicting resolution cannot overwrite it. Current role and session authority are rechecked at mutation time, not inferred from a cached screen.

The private case/action records retain minimal parent/source identity, aggregate counts/reasons and reviewer/action/time information. Queue/detail/history do not expose reporter identities or IDs and do not store post bodies/media snapshots. Eligible existing circle reports are mapped during a reviewed additive migration; original reports and unrelated global reporting remain intact. Cases and final review history survive target deletion; they are not a full immutable audit ledger or separate provider backup.

## Client behavior

Queries and note drafts are scoped to account, circle and case. A failed authority check supersedes cached protected data; changing account or circle cannot adopt an old draft or a late mutation result. Conflicting actions are disabled while saving. Loading, empty, permission, unavailable, retry and read-only resolved/self-review states have explicit controls. The feature does not add staff/global moderation, sanctions, automatic enforcement, appeals, exports, notifications or push.

## Validation and rollout

The rollout must validate the additive private schema and eligible legacy mapping in disposable PostgreSQL17, execute actual isolated HTTP/router/service/database tests, align exact health/readiness/security/recovery and encrypted backup inventories, and verify current source-equivalent CI/container checks. All test identities/data belong to disposable fixtures, never production. Fixture-context HTTP testing is not OAuth/session-provider, rendered native UI or signed-device proof.

Core implementation, private-schema activation and exact-source remote validation are complete; evidence is recorded below. Existing Cron7, schedules, data-exposure boundaries and publication state remain unchanged.

### Observed rollout evidence — 23 October 2026

Migrations 0012/0013 were rehearsed in disposable PG17 and applied atomically. The short API report-write pause prevented the old report handler from writing between anonymous legacy aggregation and the new transactional capture hook. Preflight found zero eligible old circle reports; no production test reports or posts were created. Metadata shows 27 private app tables, forced RLS on both additions and no API-role grants. Action history is append-only for the runtime role (SELECT/INSERT only); case CRUD retains its scoped service authorization.

The unchanged sanitized health function returned healthy=true, error_code=null at 2026-10-23 16:16:56 UTC; Cron7 remains active at 03:15 UTC. API and same-origin Preview are ready and reject anonymous moderator reads. 476 unit/regression tests plus the real isolated Moderation/Activity/Circle Home HTTP/PG17 suites pass; TypeScript, zero-warning lint, auditor/template/API and workflow checks pass. Real OAuth/session-provider, mounted UI/native assistive-tech and signed-device proof remain separate.

Private encrypted backup run 39985490037 succeeded. Its actual downloaded private Release, immutable producer/tag provenance, all three asset checksums, recovery-key decryption, inner checksums and exact 27-app/28-total manifest passed; temporary plaintext was removed. Exact-source CI 39986196687 and container 39986196730 passed for GitHub e7b8ecf, whose tree matches canonical 61438bd. CI includes the real isolated moderation, Activity and Circle Home HTTP/PG17 suites plus iOS/Android/Web JavaScript exports. These are not signed native/device or real OAuth-provider tests. App publication remains disabled.
