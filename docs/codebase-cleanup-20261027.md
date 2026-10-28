# Circles codebase cleanup — 27 October 2026

## Completed maintenance

This pass preserves behavior, design and shared app/admin/database contracts. It does not activate providers, identity migrations, features or deployment.

| Cleanup | Change | Safety evidence |
| --- | --- | --- |
| Unreachable starter components | Removed `components/screen-container.tsx`, `components/themed-view.tsx`, `components/ui/icon-symbol.tsx` and its paired `.ios.tsx` shim. | No executable import, registry or route reference; only historical documentation/manifest entries. Active Expo routes and platform variants remain untouched. |
| Identical foreground hooks | Added `hooks/use-foreground-state.ts`; source revalidation and live-avatar providers both use it. | Syntax-tree comparison confirms the former hook implementations are equivalent, the source controller body is unchanged and the avatar provider differs only in the hook call name. Consumers retain independent state/listeners. |
| ESLint module clarity | Renamed `eslint.config.js` to `eslint.config.mjs`; formatter recognizes the explicit module filename while retaining legacy support. | Configuration bytes/rules unchanged. Direct ESLint and Expo lint discover it without the former Node module-type warning. No package-wide module-mode change. |
| Regression coverage | Added five foreground-hook cases; retained provider/formatter assertions against the extracted implementation. | Native state, web visibility/focus, listener removal, document-less fallback and independent consumers tested under explicitly mocked React/native/DOM lifecycles. |

The baseline already passed unused-local/format checks and contained no committed generated build/cache/log files. Nothing was removed merely because it had few references. The historical155-file upload manifest remains immutable provenance, not a current inventory. Standalone operator tools, public/shared exports and small security-adjacent helpers remain local where abstraction would add risk or indirection.

## Validation and limits

Pinned Node22.23.4/pnpm9.12.0 ran credential-free local checks with production database/provider variables absent.

| Evidence | Result |
| --- | --- |
| Full local unit/JUnit suite | **845 tests across168 files; zero failures, errors or skips** |
| Focused hook/provider/revalidation/formatter suite | **22 tests in five files**; overlapping results are not summed |
| Eight local gates | Strict TypeScript-unused, zero-warning lint, tracked formatting, units, environment template/CI contract, API build and synthetic auditor tests passed |
| Protected baseline |70 source/assets/schema/dependency/native-configuration hashes unchanged |
| Accepted admin manifest |66 production-module hashes and15 SQL hashes unchanged |
| Read-only integration review |No blocker; account/controller/registration/expiry guards preserved |
| Exact-source GitHub CI |All four jobs and every recorded step succeeded, including feature/identity PostgreSQL17 drills, API and web/iOS/Android JavaScript exports |

Initial new-test harness lint failures (hook naming and probe immutability) were preserved, then fixed by separating a pure probe component from mocked harness setup. No lint rule or assertion was weakened. Successful earlier gates were retained; failed and previously unexecuted gates resumed.

Mocked lifecycle tests are not actual React Native rendering, physical-device/assistive-tech or real-account/provider proof. JavaScript exports are not signed native builds. Backend/SQL were unchanged: prior localPG17 evidence was reused locally, while the automatic CI actually reran its isolated feature/identity drills. No new container run, native/WebRTC/TURN verification or operational100% parity is claimed.

## Saved source and CI

| Receipt | Identity |
| --- | --- |
| Local canonical cleanup commit |`cfe97e0c2c9925b1353ce500662f724e90ad802a` |
| Accepted GitHub mirror cleanup commit |`0aca4801c212356ac5eede752e933d75db7ca164` |
| Matching tested tree |`6dd2d94f275402acf097208b47cd1a7c2453a86b` |
| Successful exact-source CI |[40482697231](https://github.com/mattwms76/Circles/actions/runs/40482697231) |

Both source trees were saved cleanly in normal histories. A later documentation-only status closure does not change tested code and deliberately avoids redundant CI. Exact receipts, failed evidence and incremental recovery bundles remain outside Git under `/home/ubuntu/circles-cleanup-20261027/`.

The known managed canonical fetch protocol blocker remains unresolved. It was not retried, bypassed or treated as a recorded Manus checkpoint. Local/mirror saves are distinct from canonical acceptance; supported transport assistance belongs to [Manus help](https://help.manus.im).

No live database read/write, SQL/grant, dependency, credential, backup/schedule, provider/ordinary identity/reader activation, API/Metro restart, native identifier or publication change was performed by cleanup. Fixed services remain on3000/8081 and publication stays disabled. Separate admin/consumer privacy boundaries and all prior operational gates remain intact.
