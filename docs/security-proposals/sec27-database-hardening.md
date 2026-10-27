# SEC-019 / SEC-020 / SEC-032 / SEC-033 — database hardening proposal

**Status: prepared and gated.** This is a source-level design and review package. It does **not** apply SQL, alter grants or policies, read application rows, inspect secret values, change a DSN, rotate credentials, touch `identity0014`, activate the sealed reader, change the separate administrator bundle, or alter backups, Cron, alerts, services, or deployment configuration.

## SEC-019 — restrictive actor-context RLS defence in depth

The current `circles_app_runtime` RLS policies are intentionally server-trust policies: most use `USING (true)` / `WITH CHECK (true)`. Current application resource authorization, numeric actor derivation, and parent-to-lease transaction locks remain authoritative. The finding is therefore a conditional defence-in-depth gap, not a demonstrated browser or API bypass.

A blanket policy rewrite is not safe. It would risk breaking the established server-side social, messaging, live, activity, moderation, session, and encrypted-media contracts; in particular it could change membership-revocation linearization or parent/lease lock order. **Do not apply a policy to all 27 tables, and do not modify live tables in this remediation.**

A later reviewed implementation may introduce a transaction-local, server-derived numeric actor setting only for a traced high-impact slice. Its contract must meet all of the following conditions:

1. The server derives the actor from an already validated session/context, never from a tRPC input, header, cookie string, cached account key, or client-selected ID.
2. It sets an exact decimal numeric actor with `set_config(..., true)` or equivalent `SET LOCAL` inside the same transaction that evaluates the query. Connection-pool release, error, and retry paths must clear it automatically; no session-scoped actor setting is allowed.
3. Missing, zero, negative, malformed, or mismatched settings deny rather than widen rows. Policies must use a non-throwing validated setting expression so malformed state does not become an availability bypass.
4. Candidate policies are first reviewed table-by-table against actual server queries. The initial matrix must cover only a coherent slice, such as self-owned profile/preferences and direct session rows, and keep current parent membership checks for circles, posts, membership transitions, live streams/leases, activity, moderation, and media references until their independent trace proves compatible.
5. Mutations retain the existing caller/resource authorization immediately adjacent to the query and preserve current serialized parent-lock ordering. RLS is an additional fence, not a replacement for those checks.
6. A disposable PostgreSQL 17 drill proves: no-context denial; malformed-context denial; actor A cannot see/update actor B; intended owner reads/writes succeed; parent membership revocation races retain their reviewed linearization; and pooled/retried transactions cannot retain a prior actor.

The parent owns server transaction wiring and shared query/context integration. This module deliberately supplies neither an all-table RLS migration nor a permissive fallback policy.

## SEC-020 — dedicated bootstrap connection principal

`server/_core/postgres-config.mjs` currently accepts only the exact privileged `postgres` connection principal for the approved project. That remains a privileged server-side trust boundary; it is not described as least privilege. `server/runtime-role-pool.ts` retains its existing per-checkout `SET ROLE circles_app_runtime` guard and now contains a pure strict readiness evaluator for the proposed bootstrap identity.

`operations/security-proposals/sec27-runtime-bootstrap-principal.sql` is **not an applied migration**. It prepares a reviewed `circles_app_bootstrap` LOGIN role that is non-superuser, `NOINHERIT`, `NOBYPASSRLS`, has no direct `circles_app` object privileges, and has only the reviewed `SET ROLE circles_app_runtime` membership edge. It contains no password, DSN, provider-specific pooler username, arbitrary role input, `PUBLIC` change, admin/reader access, or identity migration change.

Activation remains blocked until the owner can use protected controls to provision the role, establish the provider-supported custom-role connection form in a disposable rehearsal, and coordinate an API-plus-backup secret update. Parent-owned configuration must then require an exact value-free readiness result after `SET ROLE`: `session_principal=circles_app_bootstrap`, `runtime_role=circles_app_runtime`, and `may_set_runtime_role=true`. Any missing/other value fails closed. The current privileged DSN is intentionally not changed in this candidate.

## SEC-032 — legacy `public` privacy contract required

Catalog metadata alone shows broad authenticated reads on legacy UUID `public.circles`, `public.profiles`, and `public.follows`; it does not establish an observed row disclosure or define the retired product's privacy contract. These tables are separate from numeric `circles_app`, and this proposal makes no `public` grant, policy, view, function, row, or Data API change.

The owner must first classify each legacy field and intended audience. At minimum, `public.circles.welcome_text` and `public.circles.rules` require an explicit private-circle Home decision; `public.profiles.interests` and `public.profiles.onboarding_completed_at` require an owner/private-preference decision. Follow relationships need their own visibility decision. Discovery teaser fields remain separate from private Home and preference data.

Three compatible alternatives require independent review against the legacy client and migration/retention contract:

1. **Projection boundary.** Replace broad signed-in table reads with a fixed discovery projection/view or narrowly defined read procedure containing only approved teaser fields, such as stable circle identity, display name/slug, public image/category, and an intentional privacy/joinability indicator. Exclude `welcome_text`, `rules`, `interests`, and `onboarding_completed_at`. This preserves discovery without treating private Home or preferences as a teaser.
2. **Membership-aware reads.** Keep a bounded public/private circle projection, but require a reviewed current approved-membership predicate before returning Home fields. The exact UUID membership relation, states, and owner/moderator semantics are unverified here and must be supplied by the legacy contract; do not guess a table or use a permissive `auth.uid()` shortcut.
3. **Separate preference projection.** Expose public profile fields through a fixed projection while making interests/onboarding metadata self-only, owner-only, or unavailable according to the approved contract. If historical data must remain, use an additive, reviewed transition with explicit backfill/retention treatment; do not silently null, move, or rewrite rows.

Before any provider change, test a synthetic legacy schema with anonymous, signed-in nonmember, pending member, approved member, owner/moderator, and self-profile cases. Assert exact columns rather than `SELECT *`, preserve discovery cards, and verify that no `circles_app` numeric actor, consumer route, or separate admin permission is affected.

## SEC-033 — protected coordinated rotation/revocation and value-free attestation

No credential validity was inspected and no rotation/revocation occurred in this remediation. The historical database credential and temporary personal token must never be copied into source, logs, commands, tickets, test fixtures, shell history, or an attestation. The old PAT is never reused.

An owner with the required protected provider and secret-write access must use this sequence:

1. Confirm write authority for **both** existing consumers of the database credential: the application runtime and encrypted backup workflow. If either cannot be updated and verified, stop; do not reset the shared database credential.
2. Create/rotate the replacement only through the protected provider control plane. Distribute the replacement only to the authorized app and backup secret stores; do not print, export, or compare secret values in a shell, report, or source file.
3. Verify each consumer by its approved read-only/health mechanism with sanitized outcomes. Preserve current backup encryption, retention, and app availability boundaries; no restore, fixture, provider activation, or manual backup is implied.
4. After both consumers have an acknowledged replacement and the owner has a rollback/incident decision, revoke the specifically exposed temporary GitHub PAT through protected account controls. Do **not** revoke, replace, or disturb the working GitHub integration.
5. Revoke the retired database credential only after the coordinated app-and-backup cutover succeeds. Keep value-free provider audit references under owner-controlled access.
6. Record a value-free attestation: UTC completion time; protected-control actor/reference; `database credential rotated` boolean; separate `app consumer acknowledged` and `backup consumer acknowledged` booleans; `exposed temporary PAT revoked` boolean; `working integration unchanged` boolean; opaque provider audit/event references; and a statement that no secret values, token prefixes, DSNs, hashes, or test attempts are included.

Until that protected evidence exists, SEC-033 remains `verification_required`, and SEC-020's current privileged connection trust remains gated.

## Validation boundary

`tests/sec27-database-hardening.test.ts` is credential-free static/source validation. It proves the exact source documentation count, strict readiness-evaluator shape, and proposal safety markers. It is not proof that a provider role exists, a pooler accepts it, RLS matches a legacy contract, credentials were rotated, a PAT was revoked, a backup consumer was updated, or a live database accepts any proposal.
