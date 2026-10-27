# Circles media continuity

`recovery-continuity.mjs` is a **manual, bounded, read-only** continuity helper for Circles-owned encrypted social uploads. It is intentionally separate from the established database backup workflow: it does not modify `backup.py`, does not add a workflow or schedule, and does not place anything in the database backup artifact directory. In particular, it never creates or uploads the three assets reserved for the existing backup Release workflow.

## What the application actually stores

Circles upload records are in `circles_app.socialUploads`; the application accepts only canonical keys shaped as:

```text
social-encrypted/<positive-user-id>/<UUID>.(jpg|png|webp|mp4).enc
```

Each object is encrypted as one AES-256-GCM frame. Its key is derived from the existing `MANUS_JWT_SECRET` plus the literal `circles-media-v1`. **Do not rotate the existing signing key as a recovery shortcut**: doing so makes stored encrypted uploads unreadable. Application references may occur in profile avatar/cover, circle image, post media, message media, or live-stream thumbnail fields.

The production database backup includes the relevant rows and canonical storage keys, but it does not include object-store bytes or the signing/encryption material. This tool inventories those records and reference counts in the private app schema, then can make a separately encrypted owner-held package of bytes that the current app media proxy authorizes.

## Safety boundary

- The inventory opens `REPEATABLE READ READ ONLY`, has a 5-second lock timeout and 30-second statement timeout, reads only `socialUploads` metadata plus aggregate reference counts, and stops at configured object/byte caps (defaults: **250 objects**, **200 MiB** total; hard caps: 1,000 objects/500 MiB).
- It accepts only exact Circles managed-upload keys, exact canonical `/manus-storage/<key>` URLs, and the application MIME allowlist. It never accepts an arbitrary storage key, URL, file path, role, or SQL identifier.
- Byte export requests only `GET /api/media/<validated-key>` on an explicit canonical origin. A public HTTPS target must exactly equal the already-injected canonical `EXPO_PUBLIC_API_BASE_URL`; this binds a bearer-bearing export to the current app rather than every `*.manus.computer` host. Loopback HTTP(S) remains available for controlled synthetic tests. Redirects are refused; no Forge/S3/Supabase Storage provider credential is read or requested.
- A separate owner-held bearer file is required only to call the existing protected application endpoint. It must be regular, owner-owned, non-symlinked, and `0600` (or stricter); it is never logged. The tool cannot escalate that bearer or bypass per-object authorization.
- Plaintext inventory and input files must live in an owner-owned `0700` directory. The script creates every transient directory as `0700`, every plaintext file as `0600`, destroys transient contents, and writes only an `0600` age ciphertext as final export output.
- The exporter validates the backup repository recipient against its currently approved public `age1…` recipient. It does **not** read an age identity. It uses `age` with the public recipient only; no plaintext package is an output artifact.

## Operator procedure

Use only in a controlled owner shell with the already approved, injected PostgreSQL runtime configuration and the current canonical `EXPO_PUBLIC_API_BASE_URL`. The tool never loads `.env` files. This is not an instruction to request, print, or put a database URL on a command line.

1. Make an owner-only directory and arrange a protected runtime where the existing database configuration is already injected. Do not use the live database as a restore target.
2. Produce a bounded metadata inventory (this is read-only):

   ```bash
   umask 077
   mkdir -p /private/circles-continuity
   chmod 700 /private/circles-continuity
   node scripts/recovery-continuity.mjs --inventory \
     --inventory-output /private/circles-continuity/media-inventory.json
   ```

3. Revalidate the saved inventory before any byte retrieval:

   ```bash
   node scripts/recovery-continuity.mjs --verify-inventory \
     --inventory-file /private/circles-continuity/media-inventory.json
   ```

   The output contains only aggregate object/byte/reference counts. An inventory failure or cap breach is not a partial-success condition.

4. If an authorized recovery principal is available **and is able to read every inventory object**, first confirm the injected `EXPO_PUBLIC_API_BASE_URL` is the current canonical app origin. Place only its bearer in `/private/circles-continuity/media-auth.json` as `{"bearerToken":"..."}` with mode `0600`. Supply that same exact origin as `--media-origin`, the current approved public recipient file from the separate backup repository, not a private identity, and export a single separate ciphertext:

   ```bash
   node scripts/recovery-continuity.mjs --export \
     --inventory-file /private/circles-continuity/media-inventory.json \
     --media-origin https://CURRENT-APP-ORIGIN.manus.computer \
     --media-auth-file /private/circles-continuity/media-auth.json \
     --recipient-file /secure/Circles-backups/recipient.txt \
     --output-file /private/circles-continuity/circles-media-continuity.age
   ```

   Export fails and removes its final ciphertext if any inventory object cannot be fetched exactly at its declared byte length. It does not produce a partial continuity package.

5. Include the existing media derivation material only after an explicit owner decision and only from a separately staged, owner-only, single-line file containing the **existing unrotated** `MANUS_JWT_SECRET` value:

   ```bash
   node scripts/recovery-continuity.mjs --export ... \
     --include-signing-material \
     --signing-material-file /private/circles-continuity/existing-signing-material
   ```

   The flag is required; the script never reads `MANUS_JWT_SECRET` from the process environment. The final age ciphertext is the only permitted place this optional material is packaged. Keep the private age identity offline with the owner; do not place it in the application, a workflow, or the recovery input directory.

## Restore planning limits

The current application exposes no global backup/recovery media authorization. A normal bearer may be denied for an object owned by another person or private conversation/circle; that is a correct safety failure, not a reason to broaden authorization. Therefore a complete all-user byte export requires an approved, separately designed recovery principal or a provider-side object-export process. This helper neither implements nor requests that missing capability.

The media proxy returns **decrypted plaintext**. The encrypted package is safe only while protected by age. A future approved non-production recovery importer would need to validate each manifest entry, encrypt each plaintext byte sequence using the preserved unrotated signing material and the current `circles-media-v1` derivation, write it under its original canonical key through an authorized storage path, and restore the matching app database rows from the existing database backup. No importer, storage restore, provider auth restore, global role restore, or production restore is supplied here.

Also obtain separately, through owner-controlled channels: the private age identity; a sufficiently authorized app recovery principal if one is approved; any provider object-retention/export mechanism needed for the full inventory; and the existing signing material only if preserving encrypted media is required. Supabase provider backups, provider-managed auth, Storage API objects, custom-role passwords, Vault/root material, and external upload destinations remain outside this tool.

## Isolated synthetic rehearsal — 23 October 2026

A disposable local rehearsal now exercises the actual export helper over authenticated loopback HTTP with two explicitly synthetic PNG objects, actual Circles AES-GCM encrypt/decrypt helpers and a generated test-only signing value. Real age encryption to the approved public recipient, CLI-only recovery-identity decryption, exact archive/member checks, inner checksums, synthetic signing roundtrip, fresh-IV re-encryption, wrong-key/tampering rejection and unauthenticated HTTP denial passed. Temporary plaintext/fixture inputs were removed and the loopback listener closed; only a private synthetic ciphertext and sanitized evidence remain outside Git.

The rehearsal used no database, real account, provider object access, production signing value or production restore. It proves this local crypto/package/re-encryption path—not global media authorization, populated production recovery, owner retention of the recovery identity, provider-managed recovery or native/live compatibility. Those prerequisites remain open. The running app's signing key was not read or rotated.

## DB-12: database recovery coverage contract

`database-recovery-manifest.json` is the DB-12 source-derived contract for recovery coverage. It is not a backup artifact, an execution plan, an approval to restore, or evidence that a provider, media store, or backup currently works.

The contract pins the reviewed source base `e0e83778af66494c60dfdd0511b51b50e3d369a5` and sanitized-catalog inventory:

- **Durable application state:** all 27 observed `circles_app` tables, including `applicationSessions` and database-side media references.
- **Durable administration state:** eight observed `circles_admin` tables (`audit`, `auth_subjects`, `entity_state`, `operators`, `report_reviews`, `sessions`, `settings`, `supabase_sessions`) and their catalog-listed helpers.
- **Durable publish state:** `circles_publish.postPublishReceipts`.
- **Operational history:** `circles_ops.health_runs`, retained as history rather than proof that a backup succeeded.
- **Recreate empty:** `circles_auth.oauth_pending_states`. Its schema/access contract may be applied after recovery, but old pending OAuth flows must not be restored or replayed.
- **Optional durable state:** `circles_identity.provider_links` only if the email/provider identity feature is actually enabled. The supplied catalog did not observe that table; the contract does not fabricate it.

The manifest contains the Circles-scoped roles, 23 observed helper functions, and 129 observed policies needed to compare a reviewed restore. Legacy `public`/`private` objects outside the current private-schema ownership contract, provider-managed Auth/Storage/platform state, credentials, custom-role passwords, media bytes, and media derivation/signing material are intentionally separate. In particular, a database row in `socialUploads` is not proof that its object bytes or existing derivation material survive.

### Offline contract check

Run only against the checked-out source and sanitized manifest:

```bash
env -i PATH="$PATH" HOME="$HOME" CI=1 \
  node scripts/check-database-recovery-manifest.mjs
```

A successful command reports `SOURCE_CONTRACT_PASS` and intentionally reports `SOURCE_PASS_EXTERNAL_RECOVERY_UNVERIFIED` until a parent-authorized reviewer supplies redacted evidence. The program has no network, database, provider, GitHub, backup-store, media, dotenv, or credential client.

### Authorized external verification prerequisites

Only a parent-authorized owner or connector may perform the following. Do not put asset locations, database URLs, tokens, private age identities, signing material, SQL results, or row data in the evidence file.

1. Read the current successful backup run and expected encrypted asset set. Confirm artifact integrity and retention through the authorized control plane. A watchdog result is not a substitute for a successful backup run.
2. Use an explicitly approved, isolated, non-production PostgreSQL 17 target. Compare the durable application, admin, publish, and health-history groups, schema metadata, roles/functions/policies, and row counts. Never restore to production.
3. Apply or recreate `circles_auth.oauth_pending_states` empty. If optional identity is enabled, compare and restore `provider_links`; otherwise record `not_enabled` rather than claiming identity recovery.
4. Verify media reference inventory, media object bytes, and continuity of the existing derivation/signing material through their separately guarded process. Do not rotate a key as a shortcut.
5. Verify provider-managed Auth, Storage, platform configuration, and the reviewed custom-role contract separately. This script cannot establish those facts.
6. Create a `0600`, non-symlinked, redacted attestation outside this repository, then shape-check it locally:

```bash
env -i PATH="$PATH" HOME="$HOME" CI=1 \
  node scripts/check-database-recovery-manifest.mjs \
  --evidence /owner-only/redacted-recovery-attestation.json \
  --require-evidence
```

The evidence must have exactly this public-safe shape (use a real current timestamp and opaque run reference; values shown here are illustrative):

```json
{
  "format": "circles-database-recovery-evidence-v1",
  "manifest_version": 1,
  "observed_at": "2026-10-27T12:00:00.000Z",
  "provenance": {"method": "authorized_read_only_external_review", "run_reference": "owner-review-id"},
  "backup_assets": {
    "current_successful_run_inspected": true,
    "encrypted_asset_set_inspected": true,
    "artifact_integrity_verified": true,
    "retention_verified": true
  },
  "isolated_restore": {
    "target_kind": "isolated_postgresql_17",
    "production_target": false,
    "network_isolated": true,
    "durable_application_state_verified": true,
    "durable_admin_state_verified": true,
    "durable_publish_state_verified": true,
    "operational_history_verified": true,
    "oauth_recreated_empty": true,
    "optional_identity_status": "not_enabled",
    "optional_identity_mapping_verified": false
  },
  "media_and_keys": {
    "media_reference_inventory_verified": true,
    "media_bytes_continuity_verified": true,
    "derivation_material_continuity_verified": true,
    "no_material_embedded": true
  },
  "provider": {
    "managed_auth_verified": true,
    "storage_verified": true,
    "platform_configuration_verified": true,
    "custom_role_contract_verified": true
  }
}
```

A complete redacted attestation is only a fresh reviewer assertion with required fields; it remains **not independently verified** by the checker and is never a claim of live recovery success.

### Private backup source candidate

A separate, unactivated candidate exists at `/home/ubuntu/circles-db-remediation/backup-candidate`, based on authorized backup source `17251ccca208645e94c8fbd905bfc0802e442c68`. It expands the filtered future archive inventory from 28/29 to 37/38 relations by including the eight admin tables and publish receipts, while preserving data-only relation filters and isolated-only restore validation. It also contains a minimal safety-step fix to run the existing PG17 synthetic fixture as the non-root `postgres` user with a sanitized environment. That candidate has not been committed, activated, dispatched, exported, decrypted, or used against a provider.
