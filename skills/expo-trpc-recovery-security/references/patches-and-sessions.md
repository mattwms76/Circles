# Scoped patches and durable sessions

## Keep patch scope and source identity explicit

Record the real current commit/tree before changes. Use private copies for script/patch delivery; a private commit is not a Manus checkpoint. Reconcile user changes rather than force-applying a historical patch. Assign exclusive files to parallel units and document shared contracts before integration.

Keep independent lint modules separate from the backend session authority and the runtime utility. Integrate the local logout controller with its actual caller after concurrent files are merged. Preserve compiler versions, ports, app identifiers and user-requested navigation/scrollbar choices. Do not hide hook violations with broad ESLint suppression.

## Required durable authority

Mint a cryptographically random session ID, store only a fingerprint and bind it to app identity, user identity and a bounded expiry before returning a signed credential. Validate signature/algorithm/claims first, then require the matching active, unrevoked, unexpired durable row on every accepted bearer/application/fallback path. Reject legacy stateless credentials at an explicit cutover; do not add a JWT-only fallback for store failure. Fail closed on missing/store-error state.

Collect every valid request-presented credential on logout, deduplicate and durably revoke it. Clear all cookie variants accepted by the server, with correct host/path/SameSite/Secure semantics, even if remote revocation fails. Do not report successful revocation when the store write fails. Preserve strict bearer precedence during authentication; do not silently fall through an invalid bearer to a different cookie.

On native/client logout, capture the bearer before removing it. Purge local identity and account-scoped caches promptly, attempt remote revocation with the captured credential and expose failure after local cleanup. Do not clear the credential first and then accidentally send an unauthenticated logout request.

State the actual semantics: request-presented credentials, not account-wide logout; future authentications fail after revocation, not retroactive cancellation of in-flight requests. Distinguish partial sequential multi-credential revocation from an atomic transaction. Add account-wide/session-management features only if separately requested.

## Schema-first rollout and key coupling

Create one deterministic additive session migration consistent with the current schema, journal and snapshots. Do not copy unrelated message/live migrations merely because a prior candidate included them. Offline generation can prepare a migration; execution requires the authorized release process and target-environment checks.

Apply and verify the schema before serving code that depends on it. Test actual store reads/writes and cross-instance revocation in a controlled non-production environment. Keep app ID and a strong signing-key resolution consistent across instances. Existing stateless tokens will require sign-in again; communicate that cutover.

Do not rotate a signing key as a logout shortcut. Some applications derive media encryption from that key; rotation can make existing media unreadable without a separately approved versioned-key/re-encryption migration. Database credential refresh is a distinct operation and does not require changing the signing/app identity.

Plan expired-session retention separately. Do not silently create a cleanup schedule while generating patches. Check cron/scheduled credentials if those paths use the same authority; stage-test them rather than adding a legacy bypass.

## Focused verification

Test issuance-before-return, TTL cap, deleted/expired/revoked/mismatched/no-ID/store-failure rejection, multiple accepted cookie/bearer revocation, no false logout success, local purge after remote failure and captured native bearer delivery. Use synthetic signing settings and mocked stores for unit checks. Those mocks do not establish real MySQL, provider, browser-cookie, native secure-store or multi-instance behavior.
