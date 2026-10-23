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
