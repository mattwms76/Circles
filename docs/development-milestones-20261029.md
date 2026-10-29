# NEXT DEVELOPMENT MILESTONES — 29 October 2026

## Planning baseline

This is a sequential security-first roadmap from source commit `98587dd128c984aac98538c06fabd61677770238`, informed by the reconciled [security audit](security-audit-20261029.md) and its detailed [finding register](security-findings-20261029.json). Estimates are planning ranges for one suitably experienced engineer, excluding review queues and external-owner elapsed time. They are not commitments.

The sequence deliberately puts account/identity privacy, live-media containment, credential custody, qualified upstream remediation, and real operational proof ahead of new engagement features. It preserves accepted functionality wherever possible: existing OAuth and email sign-in remain supported, existing public profiles remain public, current direct messaging does not gain broad directory exposure, and no migration/provider/signing/publication action is implied by source work. Each milestone has explicit approval boundaries.

## Milestone 1 — P0: Account and social identity boundary repair

**Suggested branch:** `security/p0-identity-dm-boundaries-20261029`

**Owner role:** backend/security engineer with product/privacy decision-maker

**Indicative effort:** 8–13 engineering days, plus product review

**Dependencies.** Agree the direct-message recipient identity/consent policy and the definition of “recent primary authentication.” The work can start without database, provider, or release access.

**Deliverables.** Introduce a server-verified, short-lived, single-use, numeric-actor-bound recent-authentication intent for adding an email credential; design the matching credential inventory, removal, recovery, session-lifecycle, and notification contracts. Change direct-message open so a caller cannot materialize an unprofiled recipient as a public social profile. Preserve messaging by using a conversation-scoped display representation or an explicit opt-in/existing-profile rule. Add production-mode validation that rejects non-loopback HTTP frontend origins, and make account replacement await protected image-cache eviction before admitting the new authenticated subtree.

**Exit criteria.** Isolated regression coverage proves stale, replayed, and mismatched enrollment proofs fail; authorized proof succeeds once; removal/recovery and notification behavior are defined; opening a DM for an absent target never exposes private-source name through guest profile endpoints; remote HTTP origins fail in production mode; cache-clear failure blocks replacement authentication rather than silently proceeding. Existing OAuth, sign-in, public-profile, and conversation tests remain green.

**Approval boundary.** This is proposed source work, not authorization to implement it in this audit task. Provider confirmation/recovery settings, notification delivery, credential changes, production configuration, and any account exercise also require separate approval. It addresses AUTH-001, AUTH-002, ACCESS-001, and the source portion of MEDIA-003.

### Focused proposed first implementation batch

Land this batch as small reviewable commits on the Milestone 1 branch before any feature work:

1. Add the email-enrollment intent type, issuance/consumption helper, and negative/replay/actor tests; leave provider configuration unchanged.
2. Refactor `openDirect` to avoid recipient profile persistence as a caller side effect, with absent-target, existing-profile, retry, and concurrent-open tests.
3. Add production-origin validation and exact loopback-development tests; do not alter deployed CORS/OAuth configuration in this batch.
4. Hold protected rendering and new-account credential admission until cache eviction succeeds; show a neutral recovery state on rejection rather than exposing either account's protected subtree.
5. Document the chosen credential/DM privacy policies and link the acceptance cases to AUTH-001 and ACCESS-001.

This is the recommended **first milestone** because it removes two source-confirmed account/privacy defects without needing a destructive migration or external system access.

## Milestone 2 — P0: Live-session containment and bounded retention

**Suggested branch:** `security/p0-live-revocation-retention-20261029`

**Owner role:** realtime/backend engineer with product security architect

**Indicative effort:** 10–18 engineering days for source design/cleanup; 20–40 additional days if mediated media delivery is selected

**Dependencies.** Decide whether private live-feed removal must be immediate and server-enforceable. Obtain a retention target for signaling records and a database-index review plan.

**Deliverables.** Add a reliable abandoned-stream cleanup/retention mechanism, aggregate signaling storage budget, and indexes matching the signal poll/delete predicates. Design either (a) a mediated SFU/media-proxy transport with revocable authorization or (b) a deliberate direct-P2P product constraint and prominent privacy behavior. Make the ICE privacy policy explicit across web/native adapters; if privacy is required, set and test relay-only behavior. Define TURN credential expiry/revocation posture and the operational quota/destination policy.

**Exit criteria.** Expired streams are reclaimed without a later user operation; cleanup is idempotent under races; a disposable PostgreSQL test proves retention and expected query plans; direct-media revocation is either technically enforceable under a malicious/disconnected host test or formally restricted by approved product policy; approved browser/native test evidence demonstrates the selected ICE policy; synthetic TURN tests demonstrate expiry, quota, private-destination denial, and post-removal behavior.

**Approval boundary.** Schema/index migration, coturn changes, TURN credentials, SFU procurement/configuration, network tests, and public live activation are separate approvals. Do not treat mock client tests as real media-plane proof. This milestone covers LIVE-001 through LIVE-005.

## Milestone 3 — P0: Credential custody, media-key separation, and supply-chain qualification

**Suggested branch:** `security/p0-custody-media-keys-upstream-20261029`

**Owner role:** security/platform engineer with mobile build owner

**Indicative effort:** 12–20 engineering days, plus upstream release timing

**Dependencies.** Establish an owner-approved media-root-key custody model, an Expo/Router upgrade qualification window, and a safe release-age policy compatible with the installed package manager.

**Deliverables.** Add Git staging deny rules and tracked-file tests for recovery/key/dump classes; use a minimal Metro environment allowlist; establish a trusted `PATH`/absolute-helper policy for privileged and recovery entry points; build versioned media-key abstraction with key IDs, dual-read support, migration/rotation runbook, and tests. Qualify a supported Expo/Router parent update or planned SDK migration that removes the reachable decoder advisory; evaluate upstream resolution for Zod, node-forge, and deepmerge without forcing incompatible overrides. Add a tested publication-age/exception process while retaining frozen-lock installs.

**Exit criteria.** Synthetic staging and hostile-PATH tests fail closed; server-only environment variables are absent from Metro; media encryption/decryption works with old and new key IDs and rejects unsupported/tampered frames; signing-secret rotation is no longer relied upon for media migration; a frozen-lock fresh production audit shows the qualified upstream graph change, or each unresolved family has a dated owner exception and source-traced reachability statement. No custom decoder, crypto parser, or audit ignore is introduced.

**Approval boundary.** Key provisioning/rotation, signing credentials, publication, package install/update, build signing, and provider changes remain separately authorized. This milestone addresses MEDIA-001, OPS-001 through OPS-004, and DEP-001 through DEP-005.

## Milestone 4 — P1: Owner-approved database and ingress boundary activation

**Suggested branch:** `security/p1-db-ingress-attestation-20261029`

**Owner role:** database/platform owner with security engineer

**Indicative effort:** 10–18 engineering days plus owner change window

**Dependencies.** Explicit owner approval for read-only catalog inspection, role/DSN cutover, migration ordering, and non-production ingress testing. Preserve historical migration bytes and recovery manifests.

**Deliverables.** Perform value-free catalog attestation for migration journal, ownership, ACLs, policies, RLS/force-RLS, functions/search paths, role attributes/membership, session/effective role, and prepared-migration state. Cut over to a dedicated LOGIN bootstrap identity with `SET ROLE`-only membership where approved. Produce a table-by-table actor-context RLS design beginning with recipient Activity and direct/circle conversations. Configure and test a provider-neutral edge admission contract and the narrow trusted-proxy/listener-isolation/header-replacement contract. Add a terminal generic Express error envelope.

**Exit criteria.** Authorized disposable and staging evidence proves restricted effective role, bad-checkout destruction, direct listener denial, forged/multiple forwarding-header rejection, shared quotas across workers/restarts, correct 429/Retry-After behavior, no debug stack response, and selected cross-actor database denials without breaking admin/background paths. Every applied migration is reconciled to exact journal evidence; unapproved prepared SQL remains unapplied.

**Approval boundary.** This milestone includes database and infrastructure actions only after signed owner approval. It must not infer installed state from SQL files. It addresses ACCESS-002 through ACCESS-004, AUTH-003, HTTP-001 through HTTP-003, and relevant prepared migrations 0023–0025.

## Milestone 5 — P1: Staged provider, native, TURN, and recovery evidence

**Suggested branch:** `security/p1-runtime-evidence-gates-20261029`

**Owner role:** release/QA lead with platform, mobile, and security owners

**Indicative effort:** 12–22 engineering days, plus test-environment scheduling

**Dependencies.** Approved synthetic accounts, isolated non-production provider/storage/TURN environment, redacted evidence handling, and a controlled encrypted recovery checkpoint.

**Deliverables.** Run non-destructive staging checks for email confirmation/recovery/delete/redirect/rate-limit settings; CORS/OAuth/cookie behavior; provider object ACL/retention/deletion posture; multi-replica admission; native iOS/Android account-switch and logout cache behavior; real browser/native candidate gathering and TURN allocation; and an isolated encrypted restore drill with catalog/media-ledger reconciliation and cleanup evidence.

**Exit criteria.** Evidence is redacted and value-free, tied to a test plan, and independently reviewed. It demonstrates the selected account, cache, object-storage, DNS/TLS, TURN, and restoration contracts—or records a named blocker and keeps the dependent capability disabled. No production user data, key material, or backup contents appear in tickets, source, or reports.

**Approval boundary.** This is evidence/operations work, not a blanket authorization to connect production systems, rotate keys, publish, or change a provider. It closes or reclassifies AUTH-004, MEDIA-002/MEDIA-004, LIVE-003/LIVE-004, OPS-005, and the runtime portions of the ingress/database gates.

## Milestone 6 — P2: New engagement features only after security gates

**Suggested branch:** `feature/p2-engagement-after-security-gates`

**Owner role:** product engineer with security sign-off

**Indicative effort:** scope after Milestones 1–5 exits; estimate intentionally deferred

**Dependencies.** Milestones 1–3 complete; Milestones 4–5 have accepted evidence or the relevant dependent capability remains disabled. Product must select only features compatible with the finalized DM, profile, live-privacy, credential, and retention contracts.

**Deliverables.** Select one focused product increment behind the finalized privacy interfaces: privacy-preserving Activity push notifications with preference/mute controls and authorized deep links; a DM-request/blocking flow consistent with the agreed consent model; or measurable discovery/recommendation improvements. These are candidate features, not automatically approved scope. Every new protected route must bind the server actor, scope resources under the chosen data model, and include negative authorization and lifecycle tests.

**Exit criteria.** Security sign-off confirms no new feature bypasses the enrollment, profile visibility, direct-message, live revocation, rate-limit, credential-custody, or RLS/ingress contracts. Any dependency or native/provider assumption introduced by the feature has a qualified owner and test plan.

**Approval boundary.** This milestone must not become a workaround for blocked upstream, database, provider, signing, or publication work. If a prerequisite remains unproven, retain the applicable feature gate rather than weakening the controls.

## Ongoing governance

Maintain the finding register by stable ID rather than recounting scanner paths. Re-run fresh full and production dependency audits after every lockfile change; record advisory family/version reachability separately from tool path count. Treat new Gitleaks and Semgrep output as leads requiring value-free triage, not automatic vulnerability or clean-scan claims. Keep live migrations, provider operations, credentials, signing, and publication under explicit owner approval with redacted evidence.
