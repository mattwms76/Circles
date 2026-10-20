# Circles continuous integration

The GitHub workflow in `.github/workflows/ci.yml` runs on pushes to `main`, pull requests, and manual dispatches. It executes in the separate [mattwms76/Circles repository](https://github.com/mattwms76/Circles/actions/workflows/ci.yml). The Manus-managed mobile repository remains the source for Dashboard native builds; saving the workflow there does not execute GitHub Actions.

## Automated checks and build outputs

The checks job installs the exact pnpm version declared by `packageManager` in `package.json`, currently `9.12.0`, and uses Node.js 22. Dependencies come from `pnpm-lock.yaml` with `--frozen-lockfile`; the existing pnpm 9 lifecycle-script policy is preserved. The job checks the environment template and browser-safe CI settings, runs TypeScript, executes the unit/regression suite, and compiles the Express/tRPC API. Test failures stop the build rather than being ignored.

After that job succeeds, three matrix jobs compile the web, iOS, and Android Expo bundles. Worker concurrency is bounded to one per export to keep memory use predictable. The web output includes static routes and browser assets. The iOS and Android outputs contain the JavaScript/Hermes bundles and referenced assets; they are **not** APK, AAB, IPA, TestFlight, simulator binaries, or signed store builds. Compiling them verifies module resolution and platform-specific application source, not camera/microphone behavior on a physical device.

Each run uploads JUnit test results, the compiled API entrypoint, and one artifact per platform. Artifacts have unique names incorporating the commit SHA and are retained for 14 days. Only explicit build/report directories are uploaded; hidden files, local `.env` files, signing files, dependency folders, and database exports are not included. The API bundle uses external npm dependencies and therefore still needs its locked dependency installation to run.

## Credentials and database safety

No repository secrets are required for the configured workflow. It never runs migrations or starter-content seeds and has no database URL. It does not request production OAuth credentials, storage keys, signing secrets, or Expo account tokens. The standard GitHub token is limited to `contents: read`, and checkout does not persist credentials. Fork pull requests run through the ordinary `pull_request` event, never `pull_request_target`, and do not restore or populate the trusted push-job pnpm cache. Superseded runs are cancelled.[1] [2] [3]

The workflow accepts the public repository variables `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_APP_ID`, `EXPO_PUBLIC_OAUTH_PORTAL_URL`, and `EXPO_PUBLIC_OAUTH_SERVER_URL`. These values are visible in generated app bundles and must never contain passwords or private tokens. When unset, CI uses clearly nonproduction compilation values. Artifacts built with those defaults are compilation evidence, not production-connected applications. Configure deployment-specific public values before producing deployable builds.

## Running the same checks locally

Install the pinned pnpm version and a supported Node.js 22 runtime, then run:

```sh
pnpm install --frozen-lockfile
pnpm check:env --template
pnpm check:env --mode ci
pnpm check
pnpm test:ci
pnpm build
CI=true pnpm build:app
```

The environment validator's runtime mode is stricter than its CI mode: a connected backend needs actual database, OAuth, and media settings. Follow [environment-setup.md](environment-setup.md) for local runtime configuration. Do not run the migration commands against a production/shared database just to exercise CI.

## Native release builds

Signed native builds need Expo/EAS project initialization and app-signing credentials, not just successful bundle export. The current managed mobile project uses Dashboard Android APK/AAB and iOS/TestFlight build actions. No automatic store submission or paid EAS build is configured. If a separate GitHub-native EAS pipeline is desired later, it needs an authorized Expo project, `eas.json`, configured Android/iOS signing, and a protected `EXPO_TOKEN`; a job that merely queues EAS with `--no-wait` does not establish a successful native build.[4]

## Maintaining the workflow

Actions are pinned to immutable commit SHAs of their official version-6 releases. Upgrade a pin only after verifying the official action and its runtime requirements. The package manager is read from `package.json`, not duplicated in workflow inputs; commit lockfile updates alongside intentional dependency changes. The workflow uses currently compatible Node.js 22 patch releases rather than pinning an outdated patch. A build or test failure is visible in the Actions job logs and its JUnit artifact.[2] [3] [5]

## References

[1]: https://github.com/actions/checkout "Official checkout action and credential controls"
[2]: https://github.com/actions/setup-node "Official Node setup and cache behavior"
[3]: https://github.com/actions/upload-artifact "Official artifact upload settings and limitations"
[4]: https://docs.expo.dev/build/building-on-ci/ "Expo CI build prerequisites and completion semantics"
[5]: https://github.com/pnpm/action-setup "Official pnpm setup and packageManager behavior"
