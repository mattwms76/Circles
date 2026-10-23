---
name: expo-trpc-recovery-security
description: Audit and recover Expo/React Native applications with Express/tRPC APIs, distinguish superficial health from real data readiness, prepare scoped ESLint and durable logout-revocation patches, and verify them without exposing secrets or altering production data. Use for failed Preview/data requests, runtime environment drift, React-hook lint errors, session/logout security remediation, or requests to turn this diagnosis-and-patch process into a repeatable workflow.
---

# Expo/tRPC Recovery and Security

## Establish authorization and the current surface

Identify whether the user requests an audit, downloadable tooling/patches, or actual application recovery/deployment. Deliver artifacts only for artifact requests; do not silently restart, migrate, push or deploy. Read the applicable WebDev/Expo guidance and current tool definitions before operating managed projects. Keep the mobile canonical repository Manus-managed and preserve app identifiers, ports and user navigation preferences.

Record the active device, bound project directory, current source commit/tree, worktree changes and available prior evidence. Compare prior findings only against the same source; never count an unapplied candidate or its tests as current behavior. Preserve concurrent changes. Inspect connectors before using an external service and use its authorized interface.

## Diagnose before changing anything

1. Check listener/process status, public app HTML and `/api/health`, then exercise real read-only data procedures. A 200 health response is not database or authentication readiness.
2. Inspect safe error categories and current registered diagnostics. Never print DSNs, cookies, bearer tokens, credentials, full env dumps or secret-bearing process output.
3. If current and running environments differ, compare only presence/equality or component-equality booleans. A fresh read-only connection/app-router result plus the old setting's error can distinguish configuration drift from database downtime. Do not assume a Pool is a stale single connection.
4. Reproduce browser failures only when needed for an observed defect. Reload to distinguish cached content from current readiness; wait for settled state before judging error-versus-empty behavior. Keep authenticated/native/provider/device tests distinct from public screenshots and synthetic tests.
5. Report confirmed runtime failures, source-confirmed bugs, conditional risks, policy decisions and verification gaps separately. Private-membership teaser metadata is not automatically a content-access bypass; a missing workflow is not a reproduced crash.

Use [runtime-recovery.md](references/runtime-recovery.md) for trusted refresh, process ownership, strict endpoint coverage and service-manager boundaries.

## Recover only when authorized

Discover current public addresses from configuration/environment rather than copying an old session URL. For managed Expo, retain API 3000 and Metro 8081. Synchronize trusted runtime through the real `webdev.config` `GET env` operation and require applied sync; do not invent a standalone MCP CLI. Validate the new settings read-only before stopping anything.

Restart only the identified API service when it needs refreshed settings. Preserve healthy Metro; never wildcard-kill unrelated processes, switch ports, or start an unmanaged detached daemon. In Manus, use the authorized job/service tools with the exact project `cwd` and `service=true`; remove CI from resident development processes. For local operators, use an explicitly configured existing manager/restart adapter.

Read `scripts/recover-api.mjs --help` and [runtime-recovery.md](references/runtime-recovery.md) before using the bundled one-shot utility. Supply `--project-dir` for the actual current source repository when running the skill's copy; the skill directory is not the app. Use dry-run first for recovery. After Host-managed recovery, use `--verify-only` against the current explicitly supplied public origin without any additional restart or runtime-secret export. Public HTTPS proxy verification is distinct from fixed internal API 3000/Metro 8081 listener policy; do not demand public port 3000 or reuse historical Preview addresses.

Supply runtime secrets only through a protected env file or a trusted configured provider, and verification credentials through a private auth file; do not place them in CLI arguments. Bind every credential-bearing target to canonical loopback API:3000 or the exact trusted configured API origin before reading auth files; an arbitrary supplied host or sibling Preview hostname is not trusted. Reject userinfo, noncanonical ports, paths and redirects, and omit rejected target values from reports. Verify real data reads after restart and report missing auth/context as incomplete, not passed. Never invoke mutations merely to create verification fixtures. The bundled verifier covers the reviewed current Circles query inventory; re-scope definitions explicitly for another app rather than claiming automatic universal API discovery.

Consult [utility-cli.md](references/utility-cli.md) for exact mode examples, manager requirements, private context and exit statuses. Reuse `templates/recover-api.manifest.json` only after confirming it matches the current source-derived query inventory.

## Prepare scoped patches

Create an exact current-tree private workspace, record the real base SHA/tree, and keep the live repository unchanged unless applying was requested. Before code edits, confirm registered languages or use the existing standalone check-only commands in unbound private workspaces. Preserve the frozen framework/dependency set.

When five or more independent modules need judgment, read workflow-composer and use its parent-only deterministic fan-out: one agent per module, exclusive file ownership, common contracts and evidence, then one integrator. Keep the parent on orchestration rather than duplicating each module's research. Separate parallel copies and isolate compiler caches for final builds.

Fix React-hook lifecycle/ref findings through actual refactoring, not global disables or timer/cast tricks. Scope Node-only Expo rules and stored orchestration-function parser exceptions deliberately. Preserve WebRTC readiness/track cleanup, Expo Go guards, image authorization, hydration, saved/draft semantics and logout transitions. Check the exact lint command that produced the findings; do not equate all warnings with runtime crashes.

Use [patches-and-sessions.md](references/patches-and-sessions.md) for durable logout authority, migration ordering and key coupling. Do not reuse a historical patch without exact-base verification. Never rotate the signing key as a logout shortcut.

## Validate and deliver honestly

Run isolated TypeScript, lint, tests and API build with real credentials removed. Run bounded Expo bundle exports with private dependencies/caches when relevant; do not call these signed native releases. Use one read-only integration reviewer and correct only confirmed integration issues.

Use [verification-and-evidence.md](references/verification-and-evidence.md) to verify patch application, checksums, strict endpoint coverage and user-facing status. Close finite DB/HTTP/test resources. Do not create recurring monitoring simply to wait for current work.

Deliver the requested script, exact-base patches and concise usage/rollout guide. State what was applied, what was only generated/mock-tested and what still requires schema, real authentication, service-manager, device/provider or network validation. For skill delivery, run skill-creator validation and attach this SKILL.md; do not claim installation until the user selects Add to My Skills.

## Current durable OAuth and relay recovery

Use `/api/ready` when available to distinguish restricted database/private OAuth-store readiness from process-only `/api/health`; retain actual read-only query checks. Apply the private `circles_auth` helper migration before the changed OAuth code and recreate pending state empty during recovery. The current Circles verifier has 27 reviewed queries, including four bounded paged social reads and authenticated `live.relay`. Relay and signal reads both require an already authorized current stream/generation from a private fixture or reviewed endpoint manifest; never guess a generation or join/create a stream to pass verification. Preserve server-only TURN settings in trusted runtime refresh, never Expo/public settings, and do not equate configuration/synthetic ICE tests with real relay/native network proof.

Require the private fixture's `activeLiveContext` to match the stream and generation before live-context reads. Schema recovery requires the exact 25-table/column contract, owned identity sequences, and exact backend RLS policies; a column superset, guessed sequence, or arbitrary policy name is not healthy. Guard seed writes with the configured owner-ID match and private seed lease; never auto-seed during API recovery.

Use the current exact profile contract, including private interests/progress/completion fields. Onboarding status/recommendation queries are authenticated and read-only; never save interests, finish setup, join circles or publish posts merely to fabricate verification coverage.

Use the exact Circle Home circle-column contract and read-only `circleHome.get` check. Home welcome, rules and pinned content follow public-feed visibility or current approved private membership; pending/guest private access is not allowed. Never edit Home text or pin/unpin a post to fabricate verification coverage.

Activity Inbox adds recipient-private records and four protected read-only queries. Require an existing own activity ID for target resolution; never create comments/approvals, modify preferences or mark items read to fabricate recovery coverage. Keep unavailable activity metadata generic, actor labels public-profile-derived, and the archived MySQL import manifest separate from the current 25-table private PostgreSQL contract.
