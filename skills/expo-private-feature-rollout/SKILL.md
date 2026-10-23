---
name: expo-private-feature-rollout
description: Implement and validate account-aware Expo/React Native features backed by Express/tRPC and private PostgreSQL without production fixtures or overstated native proof. Use for community home, onboarding, rules, pinned resources or similar features requiring coordinated shared types, role/resource authorization, account-scoped UI drafts, additive migrations, exact schema health/recovery contracts, isolated HTTP/PostgreSQL tests and source-equivalent CI delivery.
---

# Private-schema Expo Feature Rollout

Use this workflow for coordinated product features, not as a substitute for the Webdev skill or Expo/tRPC recovery-security guidance. Read current platform instructions first. Re-discover configuration, source and tool contracts; do not reuse historical origins, commits, credentials or migration status as authority.

## 1. Establish scope and ownership

Read the approved plan, current TODO and nearest existing implementation. Record actual source commit/tree, dirty paths, active environment, diagnostics registration and publication state. Preserve concurrent work, native app identifiers, navigation preferences, fixed API/Metro ports and healthy listeners. Inspect enabled connectors before service operations. Do not initialize an existing app again.

Separate implementation, isolated validation, production metadata, real-account/device validation and publication. Keep unavailable native outcomes open. Extend the existing plan/TODO with the concrete actors, visibility, limits, transitions and exceptions before implementation. Do not implement an unselected follow-on feature.

## 2. Define the shared contract before parallel edits

Define a small shared module with bounded DTOs, input semantics and limits. Keep private/account-specific content out of broad discovery/profile DTOs. Reuse existing resource authorization and membership definitions.

Derive actors from validated request context. Treat optional viewer/account scope as an affinity check, never identity authority; include it in account-sensitive query keys and reject mismatch before data access. Specify same-parent resource linking, foreign/missing error equivalence, visibility filtering and deletion cleanup. Use separate desired-state operations for independent fields.

Agree text semantics across UI, API, direct service calls and SQL: code points versus UTF-16, trim, CR/LF, empty/clear behavior and normalized uniqueness. Read [migration-and-validation.md](references/migration-and-validation.md) for additive SQL and validation.

Delegate bounded backend/UI units with exclusive paths, a common contract and no production fixtures/Git/service ownership. For five or more independent comparable units, read workflow-composer and use its deterministic runner. Keep parent ownership of router assembly, operational contracts, migration and final integration.

## 3. Implement authoritative backend and account-safe UI

Recheck role, resource membership and session authority at the mutation's serialized transaction boundary. Reuse established lock order. Scope resource lookup to target and parent before revealing existence. Keep read-only queries read-only and retries desired-state safe.

Read [account-ui-and-authorization.md](references/account-ui-and-authorization.md) for freshness, draft lifetime and mutation completion. Distinguish guests, pending/approved members, moderators and owners. Never infer permission from cached DTOs or caller IDs.

Reuse the visual language and accessible React Native controls, with keyboard/safe-area, validation, loading/error/retry/pending/cancel states. Do not fabricate owner copy, silently post or join. Repair lifecycle structurally, not with timer tricks, global lint disables or unsafe casts.

## 4. Rehearse migrations before authorized live DDL

Use new additive private migration files; never rewrite applied history. Preserve rows/IDs, role boundaries and schedules. Extend exact column inventories, source-derived read-only recovery routes/manifests and operational health together. For a field-only health replacement, prove only those fields changed, not cron/grants/history behavior.

Run disposable PostgreSQL with synthetic fixtures and no production credentials. Verify actual SQL, legacy field preservation, runtime/API role boundaries, RLS count, FK clearing and exact health. Include Unicode, non-array and malformed cases. Document that `NOT VALID` future-write constraints do not certify old rows.

Apply live DDL only when authorized, after the local drill and integration review. Read the actual migration definition; use private file input for large payloads and record checksums. After an ambiguous response, inspect structured results and bounded metadata before retrying. Never rerun a successful migration or restore/test fixtures in production.

## 5. Validate and repair confirmed seams

Use one read-only integration reviewer after backend/UI settle. Supply plan/TODO, changed modules, shared contract, fixture evidence and known gaps. Fix confirmed cross-module issues and recheck affected paths instead of repeating broad audits.

Run credential-free TypeScript, zero-warning lint, regression and database-audit tests, environment-template checks, API build and workflow lint with the declared toolchain. Prefer isolated real HTTP→router→service→PostgreSQL tests when feasible; identify fixture auth/connection seams. Keep E2E out of default unit discovery. Read [testing-and-delivery.md](references/testing-and-delivery.md) before E2E/native reporting.

After authorized migration, verify bounded metadata/health and approved guest reads without logging user content. Reload only the API needing changed server code; preserve healthy Metro unless its code/dependencies need reload. Verify both API and same-origin Preview readiness, not only process liveness.

## 6. Save, await exact-source CI and report boundaries

Fetch/integrate canonical main, stage intended files and push normally. Keep managed Mobile Manus-canonical; synchronize separately authorized GitHub copies without ownership switches or conflicting-file overwrites. Compare actual source trees, not differing history-specific commit IDs. Follow current Git attribution guidance.

Locate automatic CI for the exact saved source and await it, without duplicate dispatch. Record actual final job/step conclusions; preserve failed evidence when fixing a confirmed failure. Do not claim a checkpoint/card if transport succeeded without a receipt. Saving, Preview, unsigned JS exports and publication are distinct.

Use [outcome-report.md](templates/outcome-report.md) for evidence-based handoff. Close only supported TODO criteria; retain credential/key, provider-storage, native/account, relay, release and time-dependent gaps. Deliver the feature without automatic publication or starting another unselected feature.
