# Dependency security policy

This graph uses **pnpm 9.12.0** with `node-linker=hoisted`. Lifecycle execution remains opt-in through `pnpm.onlyBuiltDependencies`; the final list is `esbuild`, `sharp`, and `unrs-resolver`. Dependency remediation must use a supported parent release or a narrowly scoped override that has an installed-consumer test. It must not use audit ignores, `--ignore-scripts`, an unused direct dependency, a broad native/framework upgrade, a local vendor-cache/forge patch, hand-written cryptography, or a decoder wrapper.

## Applied and tested source changes

- **SEC-001 — direct runtime Zod:** the declared runtime range is now `^4.6.6`, resolving to `zod@4.6.7`. The focused test loads the direct package and constructs an array schema. This remediates the reported direct `zod@4.2.1` resolution. Zod’s 4.6 release is the maintained compatible line used for this update.[1]
- **SEC-029 — Expo structured clone:** `expo>@ungap/structured-clone` is narrowly resolved to `1.4.0`. Expo 57 declares `^1.3.0` and its native winter runtime loads this exact dependency. The focused test uses an `expo`-scoped require and clones a nested value. This is a maintenance update, not a claimed CVE remediation.[2]
- **SEC-030 — ESLint patch hygiene:** the lock resolves the direct declared `^9.39.5` range to `eslint@9.39.5`. A focused synthetic `ESLint` run executes the existing Expo flat configuration without a repository-wide lint. This is not a migration to supported ESLint 10.
- **Server-only raster dependency seam:** `sharp@0.35.5` is installed as an exact production dependency and explicitly allowed in the existing pnpm lifecycle policy. It requires Node `>=20.9.0`, so the supplied Node 22.23.4 runtime is supported.[3] The focused Node test dynamically imports Sharp and decodes a bounded 1×1 PNG under `limitInputPixels: 4`. The media-validation owner must use this installed dependency only in server code and still owns all input/pixel/resource limits and media semantics.

The focused command below passed with 12 tests in two files:

```sh
env -i HOME=/home/ubuntu PATH=/home/ubuntu/.cache/circles-node-runtime/node-v22.23.4-linux-x64/bin:/usr/bin:/bin LANG=C.UTF-8 CI=1 \
  /home/ubuntu/.cache/circles-node-runtime/node-v22.23.4-linux-x64/bin/node \
  /home/ubuntu/.local/share/pnpm/.tools/pnpm/9.12.0/node_modules/pnpm/bin/pnpm.cjs \
  exec vitest run tests/sec27-dependency-consumers.test.ts tests/dependency-security.test.ts --maxWorkers=1
```

## Current audit reality and residuals

The normalized `pnpm audit --json` run exits 1. The module retained only normalized results; the parent final verification retains its credential-free fresh raw log outside Git. It still reports the following dependency families; no finding is hidden or described as clean merely because a top-level package changed.

- **SEC-001 residual gate:** the direct application Zod is 4.6.7, but the same GHSA is still emitted for `zod@3.25.76` in `expo@57.0.24 > @expo/cli@57.0.26`. No Expo 57-compatible official parent update was identified in this task. Do not force Zod 4 into Expo CLI or claim audit-clean status. A maintained Expo 57 parent update, or an approved framework migration with consumer proof, is required to remove this separate transitive result.
- **SEC-003:** `node-forge@1.4.0` remains through Expo CLI and code-signing certificates. The official advisory lists affected versions through 1.4.0 and no patched version.[4] The existing focused certificate corruption check remains a compatibility check only; it does not prove absence of the advisory condition. Do not write a custom RSA/ASN.1 verifier.
- **SEC-004:** `http-cache-semantics@4.2.0` remains on the development-only `@expo/ngrok@4.1.3 > got@11.8.6 > cacheable-request@7.0.4` path. Its official advisory still lists no patched version.[5] The project does not import it directly. Do not patch tunnel cache behavior locally.
- **SEC-005:** `decode-uri-component@0.2.2` remains via Expo Router’s CommonJS `query-string@7.1.3`. The published `0.5.0` fix is ESM default-export-only. The previously generated CommonJS bridge was physically unapplied under the required hoisted linker and caused the real consumer to throw; it was removed. Do not repeat that bridge, add a decoder substitute, or fake a clean audit. An ESM-compatible Expo Router/query-string parent migration, or proof that an exact upstream patch is physically installed under this linker, is required.
- **SEC-028:** direct `drizzle-kit@0.31.8` introduces deprecated `@esbuild-kit/esm-loader@2.6.5` and `@esbuild-kit/core-utils@3.3.2`. Registry metadata for current `drizzle-kit@0.31.11` still declares the same loader. Existing focused `core-utils` transform/transformSync coverage passes, but there is no supported replacement parent in the current compatible line. Do not treat `tsx` merely being installed elsewhere as a parent migration.
- **SEC-030 remaining gate:** ESLint 9 remains end-of-life. ESLint 10 was not installed because Expo 57’s current `eslint-config-expo` resolution includes latest `eslint-plugin-react@7.37.5`, whose peer range ends at ESLint 9. The patch update is compatible hygiene, not supported-major closure. Wait for an Expo-compatible lint consumer chain before an ESLint 10 migration.

The prior `braces` advisory was withdrawn upstream; its historical record is preserved in the earlier scan, not counted as a newly active vulnerability. The final fresh audit still reports four active families: transitive Zod, node-forge, http-cache-semantics and decode-uri-component.

## Freshness review — SEC-031

The source register’s original observation was 72 direct dependencies with 60 newer latest versions and 23 then-in-range candidates. After the authorized Sharp addition, that module snapshot declared 73 direct dependencies; the later MP4Box addition brings the final manifest to 74. At the dependency module snapshot, a new `pnpm outdated --format json --depth 0` registry review returned 59 newer latest versions: 8 currently satisfy their declared range and 51 require a range/framework/major decision. The eight in-range candidates are `nativewind`, `@expo/vector-icons`, `@tanstack/react-query`, `axios`, `prettier`, `tsx`, `drizzle-kit`, and `react-native-web`.

No bulk update was applied. `drizzle-kit@0.31.11` does not remove SEC-028’s loader chain; the React Native/Expo rows need SDK/native compatibility review; the remaining packages require consumer-specific regression scope. The registry backlog is maintenance planning, not a claim of 59 or 60 vulnerabilities.

## Install and verification rules

The manifest change first hit the expected CI frozen-lock mismatch. It was regenerated with the same sanitized environment using `pnpm install --no-frozen-lockfile`, without `--ignore-scripts`; Sharp installed successfully. Before promotion, parent ownership must retain the final frozen install result and this module’s focused consumer result. No provider, service, native runtime, account, database, credential, or release proof is implied by dependency tests.

[1]: https://zod.dev/blog/zod-4-6 "Zod 4.6"
[2]: https://www.npmjs.com/package/%40ungap/structured-clone "Structured clone package"
[3]: https://www.npmjs.com/package/sharp "Sharp package"
[4]: https://github.com/advisories/GHSA-86w9-cpqp-85rv "Node forge RSA signature verification advisory"
[5]: https://github.com/advisories/GHSA-ch52-4w7c-c8xp "HTTP cache semantics advisory"
