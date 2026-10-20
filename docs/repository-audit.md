# Circles uploaded-repository review

All **155 original uploaded files** in GitHub commit `e052ae2b320861939e919f982ebefaffc7bbe26a` match the Circles source snapshot `fc67eff2d2b0e59446235fcfb53efc4ef81c33eb`. There are no missing, unexpected, or changed files. The full Git tree is `65cadc87acf75f5934d3bf2d89561584feaa3d88`. Every path, file mode, Git blob identity, and file content was compared; the [full inventory](uploaded-file-manifest.json) records a separate SHA-256 digest and byte size for every file.

This establishes upload completeness and byte-for-byte integrity. It does not establish physical-device behavior, account/provider availability, security certification, commercial media licensing, or successful deployment. The original 155-file inventory is an immutable audit baseline; the environment, documentation, test, and CI improvements below intentionally add and update files afterward.

## Environment findings and repairs

The uploaded repository lacked an `.env.example` file. Its README described Manus-supplied runtime values without providing a configuration checklist for someone cloning the repository. The ignore rules protected `.env*.local` but did **not** ignore a plain `.env` file, leaving a path for accidentally committing local secrets.

The repository now includes a secret-free `.env.example`, an environment setup guide, and a configuration validator with separate template, runtime, and CI modes. The ignore rules protect real environment files while allowing the example template. Runtime configuration follows the variables actually consumed by the current app: MySQL, the canonical Manus project and signing fields, OAuth endpoints, browser/native API origins, and the storage adapter's current service URL/key fields. The API entrypoint already loads `dotenv/config`; no duplicate loader or provider migration was needed.

The signing secret also protects server-encrypted user attachments. A legacy cookie-secret alias alone is not an adequate replacement for the canonical media key; replacing or rotating that key without a media-key migration can make old uploads unreadable. These constraints are documented beside the relevant template fields rather than obscured by CI defaults.

No `.env` file, private signing material, database dump, or detected credential literal was present in the original tracked upload. The credential-pattern scan is a focused precaution, not a guarantee against every possible secret format. The CI workflow needs no production secrets and never runs database migrations or starter-data scripts.

## Test and build findings

The existing package manager is pinned to `pnpm@9.12.0`, and the lockfile is version 9. Public registry checks confirmed the pinned Expo, React Native, TypeScript, and pnpm packages are available. An isolated dependency installation with the exact pnpm version succeeded under a cleared environment, without accessing the application's database or account providers.

The starter logout test was still skipped despite implemented authentication. Its old expectation checked only one cookie, while the real logout clears both the application and SDK session cookies. The test has been enabled and updated to cover both secure HTTPS sessions and plain-HTTP local sessions. CI does not conceal the discrepancy with an allowed failure or a skipped job.

GitHub Actions is enabled for the repository. The new workflow runs environment checks, TypeScript, unit/regression tests, API compilation, and separate web/iOS/Android Expo bundle exports. The official action implementations are pinned to immutable commit SHAs. The workflow uses read-only repository permissions, does not persist Git credentials, restricts dependency-cache use to trusted non-PR runs, cancels superseded runs, and uploads only explicit test/build artifacts. See [continuous-integration.md](continuous-integration.md) for triggers, outputs, local reproduction, and references.

## Build and launch boundaries

The CI platform jobs produce app bundles, not signed APK/AAB/IPA or TestFlight releases. Signed mobile builds still use the current Manus Dashboard build setup. Native live video needs the WebRTC native module in an actual development or release build; Expo Go cannot validate it. Production OAuth, object storage, TURN connectivity, device permissions, and the app's shared database remain runtime concerns rather than CI credentials.

The GitHub repository remains a separate source copy. CI configuration does not change the Manus-managed mobile repository or silently establish bidirectional synchronization.

## Clean-runner integration finding

The first real GitHub CI run passed all 63 tests, API compilation, and iOS/Android bundle compilation, but failed web export. The same failure reproduced in a separate local checkout: Metro could not compute the SHA-1 of NativeWind's generated `.cache/web.css`. The installed NativeWind adapter pre-creates native cache files before the file map is built, but creates its web stylesheet later; non-watching CI did not discover that late file.

`prepare-nativewind-cache.cjs`, invoked by `metro.config.js` before Metro initialization, now creates the web cache file only if it is absent. NativeWind still generates and replaces its contents during compilation; an existing compiled stylesheet is never truncated. Three regression tests cover cold initialization, repeated initialization preserving CSS, and real filesystem failures. The installed dependencies, supported disk-output workaround, web styling, and API proxy are unchanged. The final local suite passes 66 tests with no skipped tests. The corrected local web export succeeded with 9,711 bytes of real compiled CSS, preserved hidden-scrollbar rules, and all static routes. The corrected GitHub integration run also succeeded.

## Delivered CI result

[GitHub run 39429140276](https://github.com/mattwms76/Circles/actions/runs/39429140276), for code commit `9bbaa073eacbf518494323a1309580e0d2d75b81`, completed successfully. Environment and TypeScript checks, all 66 tests, API compilation, and separate web/iOS/Android bundle builds passed. JUnit results and all four build outputs were uploaded as five artifacts. The completed repository contains 165 tracked files: the original 155-file baseline plus 10 intentional configuration, test, CI, and audit additions. A final documentation-only result commit does not alter the tested code.
