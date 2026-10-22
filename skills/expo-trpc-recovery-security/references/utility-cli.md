# Bundled utility execution

Use Node with an explicit absolute current app source directory. The skill's script copy is not inside the app and cannot infer `server/` or app dependencies from the skill directory. Review `scripts/recover-api.mjs --help` before use.

## Verify after authorized Host recovery

```sh
node /path/to/skill/scripts/recover-api.mjs --verify-only \
  --project-dir /absolute/path/to/Circles \
  --api-base-url https://current-explicit-api-origin.example \
  --auth-file /private/path/verify-auth.json \
  --strict
```

Discover the origin from the actual current configuration result; never reuse a historical Preview hostname. Verify-only accepts credential-free public HTTPS, including an explicitly supplied current Manus Preview origin, or loopback HTTP. It needs no signing/database/provider secrets, performs no MySQL/session-schema lookup and never restarts. Missing existing auth/IDs/active-viewer context is incomplete and causes strict failure. Omit the auth file only when intentionally checking partial public readiness.

## Local-manager recovery

Dry-run before apply:

```sh
node /path/to/skill/scripts/recover-api.mjs --dry-run \
  --project-dir /absolute/path/to/Circles \
  --env-file /private/path/runtime.env

node /path/to/skill/scripts/recover-api.mjs --apply \
  --project-dir /absolute/path/to/Circles \
  --env-file /private/path/runtime.env \
  --service-name circles-api --service-manager systemd \
  --auth-file /private/path/verify-auth.json --strict
```

The existing systemd unit must reference the selected fresh EnvironmentFile. PM2 uses `--service-manager pm2`, requires the existing manager's explicit absolute HOME and PM2_HOME and updates its environment. A finite existing-manager integration can use `--restart-adapter /absolute/trusted/executable`; it receives only the fixed service name and must not create a daemon. The script cannot control Manus Host jobs; do not substitute it for the actual Host config/job steps.

Runtime settings come from exactly one owner-only regular env file or a trusted absolute exporter selected through `--env-command`; do not put provider credentials in argv. Dry-run/apply resolve the app's existing mysql2 dependency from project-dir and use bounded SELECT-only preflight. Durable-session builds additionally require the session table, primary key and indexes. No migration runs. Internal targets retain API3000/Metro8081; public proxy verification is separate. Explicit modes are mutually exclusive.

## Private verification context and manifest

The private auth JSON contains `bearerToken` and an `ids` object. Existing IDs can include `circleId`, `profileId`, `postId`, `conversationId`, `streamId` and `liveGeneration`. Restrict the file to mode0600 and never commit it. Do not create/join/heartbeat to manufacture context.

For `live.signals`, require both the existing stream ID and the caller's **current positive integer generation**, supplied as `ids.liveGeneration` or a reviewed per-run `endpoints["live.signals"].input.generation` override. Do not default generation to1 or preserve a stale generation in the reusable manifest. Missing or invalid generation makes this positive check incomplete, sends no bogus signaling request and fails strict verification. Valid metadata does not replace the requirement for an actively joined authorized host/viewer.

An optional `--endpoint-manifest` may use `templates/recover-api.manifest.json` or an operator-reviewed copy. It only overrides inputs for already source-derived queries; it cannot add a mutation/new route. The bundled inventory covers14 reviewed current Circles queries, not arbitrary Expo/tRPC apps. Re-derive namespaces, definitions, classification and safe shapes for another application; report drift rather than guessing.

## Verified behavior and limits

The bundled bytes match the generation-aware recovery utility. Its22 synthetic tests cover exact signaling input, missing/invalid generation and strict incomplete behavior. Historical session rollout recorded92 app tests, zero ESLint errors and16 warnings; do not present that older scan as the current deployed source's result.

Synthetic tests use temporary/mock files and fetch/manager/database adapters, not real providers/devices. Authorized deployment verification established nine public positive reads among14 queries; five protected/context-dependent positives remained incomplete. This does not establish real account logout/revocation, provider/native/multi-instance or active-video E2E. Future runtime/schema operations still require explicit authorization. Exit0 means permitted work completed (strict requires full positive coverage); exit1 means rejected preflight/failure/incomplete strict coverage; exit2 means invalid or ambiguous CLI arguments.
