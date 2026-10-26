# Email/password sign-in — source rollout

Circles now prepares email/password sign-in and confirmation-only registration using the existing connected Supabase Email Auth provider. Google is deferred by the owner and is not a working button. Provider credentials/tokens are used only at the server’s pinned HTTPS Auth boundary; the app continues using its own durable, revocable sessions, HttpOnly web cookie and native SecureStore bearer.

## Existing ownership and permissions

Existing source numeric users, OpenIDs, roles, posts, memberships, messages and sessions are not replaced by email matching. A verified provider UUID maps through the additive private `circles_identity.provider_links` table. Connecting an existing account requires its actual authenticated Circles actor plus verified provider credentials; an existing binding cannot be reassigned. A same-email legacy collision requires explicit connection, not a new duplicate source or automatic takeover. Ordinary primary sign-in is email/password; retained legacy OAuth APIs are backward-compatibility ownership proof, not an advertised new ordinary provider choice.

New email app JWTs carry the authoritative numeric actor in an optional signed claim; the existing HMAC signature and persistent session record are still required. A missing/deleted/differently recreated numeric actor cannot be adopted by that old token. Historical sessions without this new optional claim retain existing verification behavior. API role/resource/membership checks remain authoritative; trusted runtime-role RLS is not presented as per-provider-user SQL isolation.

## Prepared SQL and configuration

`operations/migrations/0014_circles_email_identity.sql` creates only the postgres-owned mapping table: UUID primary key, unique numeric user FK with delete cascade, creation timestamp, forced RLS, runtime-only SELECT/INSERT policies and grants, and no public/API/service-role/schema-CREATE privileges. It changes neither the 27 app tables nor admin/operator Auth mappings or provider defaults. The checked migration is prepared, not live-installed by a source save.

Activation requires separately authorized installation and server-only configuration:

```dotenv
CIRCLES_EMAIL_AUTH_ENABLED=true
SUPABASE_AUTH_URL=https://vvclcsqletcxzoaayqzq.supabase.co
SUPABASE_AUTH_PUBLISHABLE_KEY=<active public publishable key>
```

No real value belongs in Git. The bridge rejects service-role/legacy JWT keys and unapproved host aliases. Disabled mode preserves previous deployment health behavior; explicitly enabled mode reports unhealthy if mapping storage or provider readiness is unavailable. Email confirmation is retained; no email delivery, password reset, actual Google/native login or signed release is claimed merely from this implementation.

## Safety and local validation

The provider password grant is followed by authoritative confirmed-user validation before mapping/session creation. Signup never invents an authenticated app session. Requests have strict bounded JSON parsing, no-store generic errors, exact browser-origin/native checks, bounded throttling/provider responses and timeout/redirect refusal. Native email writes are scoped, cancelled/drained before logout or competing OAuth writes, and failed fresh authentication confirmation cleans up/revokes the captured credential.

Credential-free local checks use the repository-pinned Node22.23.4/Pnpm9.12.0. Existing Home, Activity and Moderator HTTP/PG17 suites remain isolated. New opt-in drills are `tests/email-identity.pg-test.mjs`, `scripts/run-email-identity-e2e.mjs` and `scripts/run-email-auth-http-e2e.mjs` with `CIRCLES_EMAIL_AUTH_LOCAL_PG17=1`, `POSTGRES17_BIN=/usr/lib/postgresql/17/bin` and a clean environment. The latter’s provider boundary is synthetic: it does not establish real password, email-delivery or device success. Final accepted commits and actual local/remote results are recorded after integrated checks, never inferred from a pending run.

The private backup code must retain exact28-table current-schema backups when the identity namespace is absent and include the29th durable mapping when installed. Recovery includes explicitly allowlisted source enums/message-trigger dependencies; provider Auth, admin/operator data and transient OAuth pending states remain excluded. Actual live29-table encrypted backup/restore verification is a separate post-installation gate.

## Completed source acceptance — 26 October 2026

Current source passed654 unit/regression tests in130 files, strict unused-symbol TypeScript, zero-warning ESLint after three explicit lint-only corrections, tracked-source formatting, environment template, security-auditor tests and API compilation. Home11/Activity12/Moderator7 isolated HTTP/PG17 cases passed with removed fixtures. All three email PG17 drills ran explicitly (not skip mode); the real REST/store/JWT/session fixture passed12 cases using a strict in-process provider mock and a clearly labeled fixture-only actor lookup adapter. Read-only integration review found no remaining blocker in the six repaired seams. Private backup source17251cc passed109 Python tests and3 actual-source PG17 restore cases covering both28 and29 relation states.

These are source/local-fixture acceptance results, not live activation. The reviewed identity SQL hash is `3aa2fc177771c1851070f227606520f8c4ce4bb63641cd690b978a1b7d7e2e50`; it remains unapplied. No new Auth configuration, provider account or real password submission was made. Exact app source commit and remote CI outcomes are recorded only after they are observed. A separate review-only existing live membership-revocation timing finding remains outside this authentication change; it is not claimed repaired here.
