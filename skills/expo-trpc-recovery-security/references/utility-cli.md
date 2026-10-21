# Bundled utility execution

Use Node with an explicit absolute current app source directory. The skill's script copy is not inside the app; it cannot infer `server/` or app dependencies from the skill directory. Review `scripts/recover-api.mjs --help` before use.

## Verify after authorized Host recovery

```sh
node /path/to/skill/scripts/recover-api.mjs --verify-only \
  --project-dir /absolute/path/to/Circles \
  --api-base-url https://current-explicit-api-origin.example \
  --auth-file /private/path/verify-auth.json \
  --strict
```

Replace the origin with the actual current result of configuration discovery; never reuse a historical Preview hostname. Verify-only accepts credential-free public HTTPS, including explicitly supplied current Manus Preview origins, or loopback HTTP. It requires no signing/database/provider secrets, performs no MySQL/session-schema lookup and never restarts. Missing existing auth/IDs/active viewer context is incomplete and causes strict failure. Omit the auth file only when intentionally checking partial public readiness.

## Local manager recovery

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

The existing systemd unit must reference the selected fresh EnvironmentFile. PM2 uses `--service-manager pm2`, requires the existing manager's explicit absolute HOME and PM2_HOME and updates its environment. A finite existing-manager integration can instead use `--restart-adapter /absolute/trusted/executable`; it receives only the fixed service name and must not create a daemon. The script creates no manager and cannot control Manus Host jobs. Never substitute it for the actual Host config/job steps.

Runtime settings come from exactly one owner-only regular env file or a trusted absolute exporter executable selected via `--env-command`; do not put provider credentials in `--env-command-arg`. Dry-run/apply resolve the app's existing mysql2 dependency from project-dir and preflight connectivity using bounded SELECT-only operations. A patched auth build additionally requires the durable session table, primary key and indexes. No migration is run. Internal restart targets retain API3000/Metro8081; public proxy verification is separate. Explicit modes are mutually exclusive.

## Private verification context and manifest

The private auth JSON has `bearerToken` plus an `ids` object whose permitted existing IDs can include `circleId`, `profileId`, `postId`, `conversationId` and `streamId`. Use actual authorized context only when requested; never create/join/heartbeat to populate it. Restrict the auth file to mode0600 and do not commit it.

An optional `--endpoint-manifest` can point to `templates/recover-api.manifest.json` relative to this skill, or an operator-reviewed copy. It only overrides inputs for already source-derived queries; it cannot add a mutation/new route. The included inventory is scoped to the current Circles router structure (14 reviewed queries), not arbitrary Expo/tRPC apps. For another app, re-derive namespaces, query definitions, access classification and safe response shapes before modifying the utility. Report unsupported/drift rather than guessing.

## Verified behavior and limits

The bundled bytes match the final tested recovery utility. The focused suite passed 19 synthetic tests; the subsequently applied app passed 92 tests, TypeScript and API compilation, with zero ESLint errors and 16 separately reported warnings in its full current scan. The original private candidate scan reported 15 warnings; preserve these distinct scan scopes rather than presenting that earlier count as the applied result.

The synthetic tests used temporary/mock files and fetch/manager/database adapters. During the authorized Circles application rollout, the session migration and primary key/indexes were actually applied and checked, settings were refreshed, services recovered and nine of fourteen positive read-only queries passed through current public Preview. Five protected/context-dependent queries remained incomplete, not passed. This evidence does not establish provider/native/multi-instance/logout or active-video end-to-end behavior, and future invocations still require explicit authorization for runtime/schema operations. Exit0 indicates permitted completed work (strict requires full positive coverage); exit1 indicates rejected preflight/failure/incomplete strict coverage; exit2 indicates invalid/ambiguous CLI.
