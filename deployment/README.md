# Circles API and native release handoff

The API-only multi-stage Dockerfile uses Node **22.23.4**, pinned to the verified official multi-platform manifest, and pnpm **9.12.0** with frozen lockfile installs. It compiles without database, OAuth or storage credentials and runs as nonroot UID10001 on port3000. No container or signed native artifact is claimed merely by this source configuration.

`/api/health` is process liveness. `/api/ready` is the deployment health route: it checks the restricted `circles_app_runtime` connection, all22 RLS-enabled readable application tables, and the private forced-RLS OAuth store with its exact backend policy/privileges. It returns only sanitized booleans with no-store caching. Missing/unsafe production relay setup disables live operations rather than taking down unrelated feed, authentication and DM routes; the readiness response separately reports relay configuration availability.

## Managed configuration

Preserve the fixed mobile ports and existing features. The container declaration is:

```json
{ "deploy": { "dockerfilePath": "Dockerfile", "healthPath": "/api/ready" } }
```

The frontend/Metro remains8081 and the API remains3000. Keep auto-publish off. Publication is separate and requires the release owner's approval and an accepted canonical checkpoint; do not submit store builds or publish merely to make an attestation pass.

## Native profiles

`eas.json` contains an internal standalone `preview` profile and a `store` profile. Android preview is an APK; Android store is an AAB, and iOS uses its corresponding internal/store archive. Preserve app scheme, bundle/package IDs and the native WebRTC plugin. This does not add a development-client dependency or make ExpoGo capable of WebRTC.

The owner must configure the release account/signing path through the Dashboard, provide Android/Apple enrollment and signing access, and set the public API base to the actual stable deployed HTTPS origin before a store build. Never use an ephemeral Preview origin in a store binary. Do not put private keys, tokens or environment values in EAS JSON, images or Git.

## Readiness evidence

Run `node scripts/check-release-readiness.mjs --input deployment/release-readiness.example.json`. The example intentionally remains blocked. This checker validates value-free operator attestations; it is not a Docker build, provider request, signed-build verification or physical-device test by itself. Record real provenance only after the operation occurred. Synthetic tests, unsigned JS bundles, browser Preview and ExpoGo do not close signed/native release outcomes.

A production live-enabled release additionally needs a reachable coturn-compatible relay configured with server-only `TURN_SERVER_URLS` and `TURN_SHARED_SECRET`, using the short-lived authenticated credential flow. Real host/viewer checks across networks remain mandatory before live compatibility is claimed.

Protected media/key continuity has a separate manual guide under `operations/recovery/`. The private `circles_auth` helper migration must be applied before serving the changed OAuth code; recreate it empty during recovery rather than replaying old pending OAuth state.

Sources for the runtime pin: [Node22 security release](https://nodejs.org/en/blog/release/v22.23.4), [security advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases), and [official image manifest](https://hub.docker.com/v2/repositories/library/node/tags/22.23.4-bookworm-slim).

## Credential-free container runner validation

`container-validation.yml` is manual-only, uses a standard runner with contents:read and does not publish or upload artifacts. It builds the pinned Node22.23.4/pnpm9.12 image, validates the pinned public Supabase CA under the nonroot runtime user, then checks liveness while deliberately expecting503private-data/OAuth readiness without database credentials. Its temporary signing value is generated only for the disposable container, never used for accounts/data and discarded. A passing run proves this image-build/filesystem/startup/fail-closed boundary, not a deployed production API, valid signing/provider configuration or native-device test. The final image must retain `server/certificates/supabase-root-2021.crt`; removing that runtime copy breaks verified TLS connections even if liveness passes.
