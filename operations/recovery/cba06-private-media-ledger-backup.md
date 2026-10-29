# CBA-06 private media-ledger backup and restore gate

This is a **source-prepared scope contract**, not a backup run, a restore approval, or a provider integration. It adds no scheduler, provider client, credential, archive upload, migration execution, object deletion, or quota refund.

The only authoritative machine-readable scope is [`cba06-private-media-ledger-backup-scope.json`](./cba06-private-media-ledger-backup-scope.json). It requires the two private relations below to be included only in the existing owner-approved **encrypted database archive** once CBA-06 is separately approved and applied:

- `circles_media.socialUploadBudgets`
- `circles_media.socialUploadReservations`

Do not put ledger rows, account identifiers, managed storage references, provider URLs, signing material, archive locations, or encryption keys in a public DTO, public readiness response, source report, or unencrypted operator log. `/api/ready` intentionally exposes only boolean capability state.

## Required owner-gated sequence

1. Confirm the ordered checksum manifest in `operations/migrations/cba06-ordered-rollout-manifest.json` matches the reviewed sources. Replay remains ordered **0023 → 0024 → 0025**; CBA-10’s receipt-compatible daily wrapper and its finite 86/96 policy variants are not changed by CBA-06.
2. On an approved isolated PostgreSQL 17 target only, restore the reviewed encrypted database archive and apply the candidate 0025 migration after the preceding ordered migrations. Do not apply it to production under this source-preparation authorization.
3. Run the closed `cba06_circles_media_v1` server catalog contract under `circles_app_runtime`. It must confirm the two exact private tables, columns, constraints, indexes, owner/runtime ACLs, forced RLS, and one finite runtime policy per table. `anon`, `authenticated`, and `service_role` must be denied.
4. Compare the private ledger backfill against the surviving `circles_app.socialUploads` rows. Historical missing metadata must remain conservatively charged; no guessed object deletion or TTL-based refund is permitted.
5. Independently verify current encrypted archive retention, media object-byte continuity, and custody of existing derivation/signing material through authorized owner controls. The database archive alone does not prove those facts.
6. Only after these facts and a separate owner approval may the actual backup implementation include the CBA-06 private schema. Record redacted evidence outside this source tree. Do not represent this source artifact as live backup activation.

The existing `scripts/recovery-continuity.mjs` remains restricted to bounded encrypted-media continuity preparation. It does not enumerate or disclose the private ledger, activate an archive, or grant a global media recovery principal.
