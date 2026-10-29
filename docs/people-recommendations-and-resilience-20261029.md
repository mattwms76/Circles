# People recommendations and preview resilience — 29 October 2026

## Product scope

The owner requested interest- and follow-based People-to-know recommendations and resource monitoring/automatic service restart scripts after the preview API and Metro terminal sessions disappeared together. The earlier multi-profile characterization remains historical evidence of the old ID-only directory; it is not evidence for the changed ranking.

### Ranking policy

The existing `social.profilesPage` read remains the Home and Discover source. Authenticated candidates exclude the current user and are ordered by:

1. Profiles the viewer does not already follow, before already-followed fallback profiles.
2. Descending `100 × distinct shared allowlisted interests + 10 × min(distinct two-hop follow intermediaries, 9)`.
3. Ascending numeric user ID for deterministic ties.

A two-hop connection means the viewer follows an account that follows the candidate. Shared-interest overlap is the primary score signal; the capped graph contribution cannot outweigh one additional shared interest. Cold-start viewers with no saved interests can still benefit from their follow graph. Anonymous visitors use deterministic ID order, without pretending to have personalized interests.

Interest values are explicit existing preferences, not inferred from messages, private circle content, sensitive traits or external data. Other users’ interest arrays, match scores and intermediary identities are not added to public Profile DTOs. Already-followed profiles remain available with accurate follow state; no connection is created automatically.

Name/handle search stays server-backed and case-insensitive. The existing `{id}` cursor identifies a rank anchor recalculated server-side in the same scoped scored query; a missing or ineligible anchor must produce a safe refresh error rather than silently guessing a position. Pagination is deterministic for unchanged profile/interests/follow data. Changes between page requests can reorder recommendations; refresh to restart the current ordering. No new schema, migration or named procedure is needed.

Existing successful Follow changes already invalidate the paged profile query. Successful interest saves now invalidate it only after the saved user and still-current account agree; a failed background refresh does not turn a completed preference save into a reported save failure. Existing account-subtree/cache fences remain intact.

## Runtime supervision

`pnpm dev` and `pnpm dev:supervised` select the new foreground application-owned supervisor. Standalone `dev:server` and `dev:metro` remain available, but must not be started alongside a supervisor that already owns those ports. `pnpm services:check` is a finite read-only telemetry/liveness check; `pnpm services:status` inspects the supervisor’s local status.

The supervisor is intended to own the API and Metro processes it starts, not adopt arbitrary listeners. It must refuse busy ports, preserve API3000/Metro8081 and use the existing source/package tools. Resource and exit records are private, sanitized and bounded. Process exit/consecutive liveness failure and sustained owned-child RSS pressure can cause bounded restart; dependency readiness failures are reported separately instead of restarting a healthy process in a loop. Backoff, startup grace and a retry circuit breaker bound recovery. Intentional shutdown stops owned children without resurrection.

The ownership implementation targets the current Linux sandbox and requires readable process identities from `/proc`. It must refuse foreground startup before spawning children when that ownership mechanism is unavailable; this does not claim native macOS or Windows supervision support. Standalone framework commands remain available.

At 08:50 UTC the read-only monitor detected a separate new API failure while Metro was still available. The identified API terminal reported an unhandled PostgreSQL Client `Connection terminated unexpectedly` error. A narrowly scoped runtime-role-pool listener lifecycle correction and dedicated failure/recovery tests address that observed path; role verification, SQL guards, terminal release cleanup and uncertain-write handling remain fail-closed. This later single-service observation does not establish what caused the earlier loss of both terminal sessions.

This protects against recoverable **child-service failures while the supervisor is alive**. It does not guarantee uninterrupted service or restart the supervisor after the entire sandbox/session suspends or is lost. The earlier loss of both terminal sessions is not proven to be an OOM or application exception, and this implementation does not retroactively establish its trigger. A systemd template can provide host-level restart on an already-authorized persistent host; it is prepared separately, not installed in the development sandbox. No hosting purchase, publication, external keepalive, new scheduled task or change to database-health/backup schedules is implied.

## Verification and rollout ledger

Final local source gates passed: **1,148 tests in 225 files**, strict TypeScript/unused checks, zero-warning whole-source lint, changed-source formatting and API compilation. The six-case ranked People HTTP/PostgreSQL suite passed against the final runtime pool; existing Circle Home 11, authority 14 and security 2 cases also passed on fresh local PG17 fixtures, all removed. The checked-out/idle connection-termination drill passed both scenarios. Supervisor coverage passes 13 actual synthetic-subprocess cases, including immediate exits, spawn failure, hangs, health500, readiness503 without churn, bounded retry and intentional stop. The initial integration review’s two supervisor blockers were corrected and rechecked; its original findings are retained in external evidence rather than erased.

At **09:03 UTC on 29 October 2026**, the two exact known old resident jobs were intentionally stopped, their fixed ports verified free, and one foreground supervisor was launched as servicejob `job_Lm15I5yp`. Both owned children were verified at generation 1 with Linux identity checks, no pending restart/open circuit, API health 200/readiness ready and Metro 8081 available. Private lock/status/events permissions are 0600 in the 0700 state directory. The subsequent actual People read succeeded with no raw preferences/rank metadata in its DTO; no real-service crash was deliberately induced.

The only intentionally changed pre-recorded protected file is `server/runtime-role-pool.ts` for the observed connection-error crash; the other 67 protected-file hashes, including database schema/migrations, native IDs/assets, dependencies/lockfile, TLS and backups, are unchanged. No production fixture data, interests, follows, memberships, posts, schema/provider state, deployment or scheduled tasks were changed. The systemd unit is a prepared, uninstalled template. Synthetic request authentication is not real OAuth; native-device/build conformance and whole-sandbox recovery are not claimed.

Source acceptance is recorded separately after the normal canonical push. No GitHub/remote CI, publication or Version-history receipt is inferred from local checks or a working listener.
