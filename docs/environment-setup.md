# Environment setup

Circles uses Expo/Metro on **8081** and its Express API on **3000**. The mobile starter loads `.env` for local use, while Manus-injected environment values take precedence over any value in that file. Do not paste service credentials into source, build logs, or CI variables that are exposed to bundles.

## Start locally

```sh
cp .env.example .env
node scripts/check-env.mjs --mode ci
pnpm dev
```

The checked-in template intentionally contains **blank private placeholders**. Its only concrete endpoints are browser-safe local development values:

- `EXPO_PUBLIC_API_BASE_URL=http://localhost:3000`
- `EXPO_PACKAGER_PROXY_URL=http://localhost:8081`
- `EXPO_WEB_PREVIEW_URL=http://localhost:8081`

Those values are for a browser on the development machine. On a physical device, `localhost` means the device, not the computer running Metro/API. Before device testing, point `EXPO_PUBLIC_API_BASE_URL` at the computer's reachable LAN address, for example `http://192.168.x.x:3000`; keep it out of version control. Native API calls do not send a browser `Origin` header.

`app.config.ts` serializes only browser-safe application/OAuth endpoints and the app ID into Expo `extra`. It never serializes the signing secret, database URL, or storage credentials.

## Canonical runtime variables

The following variables are required by `node scripts/check-env.mjs --mode runtime` for the app's full OAuth + encrypted-media runtime. In a deployed Manus app, the authorized service environment supplies them; do not manufacture substitute production values.

| Variable                   | Used by                                                              | Handling                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MANUS_PROJECT_ID`         | OAuth client ID and session app binding                              | Browser-safe identifier; Manus supplies it.                                                                                                         |
| `MANUS_OAUTH_PORTAL_URL`   | OAuth authorization redirect                                         | Browser-safe HTTPS service endpoint; Manus supplies it.                                                                                             |
| `MANUS_OAUTH_API_URL`      | OAuth token/user API                                                 | Server-side service endpoint; `app.config.ts` also exposes its safe URL for client configuration.                                                   |
| `MANUS_JWT_SECRET`         | Sessions, OAuth state signing, encrypted social media key derivation | **Private.** Stable, randomly generated UTF-8 value of at least 32 characters. Rotation makes existing encrypted uploads unreadable until migrated. |
| `DATABASE_URL`             | Users, social records, media ownership                               | **Private.** Required when OAuth/media use persistent records.                                                                                      |
| `BUILT_IN_FORGE_API_URL`   | Managed object-storage presigning                                    | **Server-only.** Leave blank in local template unless authorized.                                                                                   |
| `BUILT_IN_FORGE_API_KEY`   | Managed object-storage presigning                                    | **Private server-only credential.**                                                                                                                 |
| `EXPO_PUBLIC_API_BASE_URL` | Native API/OAuth callback endpoint                                   | Browser-safe HTTP(S) API base. Use local port 3000 only for local development.                                                                      |

The runtime check confirms only presence and safe shape where relevant; it does not make database calls, retrieve secrets, or call OAuth/storage services. For `MANUS_JWT_SECRET`, it enforces a **32 Unicode-character minimum**. It cannot prove randomness, so generate and protect the value in the deployment secret store.

For Expo Web OAuth, configure at least one exact trusted frontend origin. Normal Manus preview supplies both `EXPO_PACKAGER_PROXY_URL` and `EXPO_WEB_PREVIEW_URL`; a custom deployment may use one of `FRONTEND_ORIGIN`, `WEB_ORIGIN`, `EXPO_PUBLIC_WEB_URL`, or `PUBLIC_URL` instead. Origins must be scheme + host + optional port only—no path, query, fragment, or credentials. OAuth callback approval additionally consumes `OAUTH_CALLBACK_ORIGIN`, `API_ORIGIN`, `API_BASE_URL`, and `EXPO_PUBLIC_API_BASE_URL`; the preview origins can derive the paired API origin.

## Optional metadata and compatibility aliases

`OWNER_OPEN_ID` is optional server-side ownership metadata. `OWNER_NAME`, `EXPO_PUBLIC_OWNER_OPEN_ID`, and `EXPO_PUBLIC_OWNER_NAME` are optional display metadata. They do not replace server-side authorization.

The values below are **already consumed as legacy fallbacks** by the current code. Keep them only for existing environments while migrating to the canonical names above; do not add new provider-specific fields.

| Canonical setting                | Consumed legacy/public compatibility aliases                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MANUS_PROJECT_ID`               | `VITE_APP_ID`, `EXPO_PUBLIC_APP_ID`                                                                                                                                            |
| `MANUS_JWT_SECRET`               | `JWT_SECRET` for legacy server cookie handling only; social media encryption intentionally reads canonical `MANUS_JWT_SECRET` directly.                                        |
| `MANUS_OAUTH_PORTAL_URL`         | `OAUTH_PORTAL_URL`, `VITE_OAUTH_PORTAL_URL`, `EXPO_PUBLIC_OAUTH_PORTAL_URL`                                                                                                    |
| `MANUS_OAUTH_API_URL`            | `OAUTH_SERVER_URL`, `EXPO_PUBLIC_OAUTH_SERVER_URL`                                                                                                                             |
| Browser/API origin configuration | `EXPO_PACKAGER_PROXY_URL`, `EXPO_WEB_PREVIEW_URL`, `FRONTEND_ORIGIN`, `WEB_ORIGIN`, `EXPO_PUBLIC_WEB_URL`, `PUBLIC_URL`, `OAUTH_CALLBACK_ORIGIN`, `API_ORIGIN`, `API_BASE_URL` |

`.env.example` lists every currently consumed variable—including optional origins and aliases—and `--mode template` compares it with explicit source references. `NODE_ENV`, `PORT`, and `EXPO_OS` are process/framework-managed rather than template settings.

## Checks and CI

```sh
# Safe with an empty environment: verifies only optional browser-safe URL shapes.
node scripts/check-env.mjs --mode ci

# Ensures .env.example and the source environment contract stay synchronized.
node scripts/check-env.mjs --mode template

# Use only in an authorized runtime with canonical OAuth, database, and storage values.
node scripts/check-env.mjs --mode runtime
```

CI should use `--mode ci` before TypeScript/tests/build checks. That mode requires **no production secret, database, OAuth account, storage credential, or network call**; empty public configuration compiles with the app's local/default fallbacks. The focused environment tests likewise make no Manus OAuth, database, or network request.

A plain CI build does **not** validate account OAuth or managed media. Those features require an **authorized Manus service deployment** with the canonical runtime environment and corresponding managed database/storage access.
