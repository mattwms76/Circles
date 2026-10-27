# Circles codebase cleanup — 27 October 2026

## Scope and changes

This maintenance pass is behavior-preserving, not a redesign or provider/database rollout. The reviewed baseline is local commit `3eec0aa404652de3880e609cffe65d1810e71041`, equivalent GitHub documentation state `09066918b1ad33c6c09a854b29afe448ec0e827d`.

| Cleanup | Change | Preservation evidence |
| --- | --- | --- |
| Unreachable starter components | Removed `components/screen-container.tsx`, `components/themed-view.tsx`, `components/ui/icon-symbol.tsx` and its paired `.ios.tsx` shim. | No executable import/registry/route reference; only historical documentation/manifest entries. Active Expo routes and platform variants remain untouched. |
| Identical foreground hooks | Added `hooks/use-foreground-state.ts`; both source revalidation and live-avatar providers use it. | Syntax-tree comparison proves both former hook implementations equivalent, source controller body unchanged, avatar provider body unchanged except the hook call name. Each call retains independent state and subscriptions. |
| ESLint module clarity | Renamed `eslint.config.js` to `eslint.config.mjs`; formatter supports the explicit module filename and retains legacy support. | Configuration bytes and rules unchanged. Both direct ESLint and Expo lint discover it and pass without the former Node module-type warning. No package-wide module-mode change. |
| Regression coverage | Added five foreground-hook cases and retained live-avatar/source-format assertions against the extracted hook. | Native state, web visibility/focus, listener removal, document-less fallback and independent consumers exercised under explicitly mocked React/native/DOM lifecycles. |

The initial source already passed unused-local and formatting checks, with no committed generated build/cache/log files. No code was removed merely because it had few references. The historical 155-file upload manifest remains immutable provenance, not a current source inventory. Standalone operator tools, public/shared exports and small security-adjacent helpers remain local where abstraction would add risk or indirection.

## Validation

Pinned Node22.23.4/pnpm9.12.0 ran credential-free checks with production database/provider variables absent.

- Full unit/JUnit: **845 tests across168 files; zero failures, errors or skipped cases**.
- Focused hook/provider/revalidation/formatter checks: **22 tests in five files**; overlapping results are not summed.
- Eight local gates passed: strict TypeScript-unused, zero-warning lint, tracked formatting, full units, environment template, CI environment contract, API build and database-auditor synthetic tests.
- The70 protected source/assets/schema/dependency/native-configuration hashes match the baseline. All66 accepted admin production-module hashes and15SQL hashes remain unchanged.
- A separate read-only integration review found no blocking issue. Both current consumers retain their account/controller/registration/expiry guards and separate lifecycle subscriptions.

Initial new-test harness lint failures (hook naming and probe-state immutability) were preserved and fixed by separating the pure probe component from mocked harness setup. No lint rule or assertion was weakened. Successful earlier validation gates were retained; the failed gate and subsequent unexecuted checks resumed.

These are source/unit/mocked-lifecycle checks, not real React Native rendering, physical-device/assistive-tech, account/provider, WebRTC/TURN or deployment evidence. Backend/SQL were not changed, so the prior localPG17 parity evidence is reused rather than relabeled as a fresh run. Automatic exact-source GitHub CI is pending until the accepted cleanup push completes and its run finishes.

## Source saving and operational boundaries

Only settled intended files are saved in normal local/authorized GitHub histories, with matching trees and no force-push. Exact commit/CI receipts and recovery bundle remain outside Git under `/home/ubuntu/circles-cleanup-20261027/`.

The known managed canonical fetch protocol blocker remains unresolved. It was not retried, bypassed or treated as a recorded Manus checkpoint; local/mirror saves are distinct from canonical acceptance. Supported transport assistance belongs to [Manus help](https://help.manus.im).

No database read/write, SQL/grant, dependency, credential, backup/schedule, provider/ordinary identity/reader activation, API/Metro restart, native identifier or publication change was performed by cleanup. Fixed services remain on3000/8081; publication stays disabled. Shared data/API/admin/consumer privacy contracts and all existing operational gates remain intact.
