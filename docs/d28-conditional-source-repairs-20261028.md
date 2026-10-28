# Circles — conditional design repairs and device verification

28 October 2026

## Result

All **11 originally conditional design findings have source repairs**. The previous 13 confirmed repairs remain intact: the complete register contains **24 source-repaired canonical findings and 5 preserved aliases**. Original classifications and historical evidence remain unchanged. Source remediation is complete; **physical Android and native keyboard verification are not complete**.

Matt selected an Android phone connected through Matts-Air. Fresh device discovery at 18:01 UTC reports the Mac online but **`needs_workspace`**, with no authorized folder. Phone model/OS, USB authorization, installed native build and source running on the phone remain uninspected. A deferred request asks Matt to open/select a Circles or testing workspace on that Mac. No physical result is inferred from the user’s offer of a connected phone.

## Source changes

| Finding | Implemented repair                                                                                                                                            | Main source                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| D28-004 | Discover Live thumbnails use responsive 16:9 framing instead of a fixed 180-point height; cover fit, card target and copy remain.                             | `app/(tabs)/discover.tsx`       |
| D28-005 | At measured People-card width ≤ 320, identity and existing profile/follow-state action have deliberate separate, full-width rows.                             | `app/(tabs)/discover.tsx`       |
| D28-007 | Moment options have safe-area padding and one bounded scrollable action stack; sibling backdrop, busy guards and Report → Remove → Close order remain.        | `components/post-card.tsx`      |
| D28-009 | Checking/error/guest email guards gain local overflow recovery; the authenticated EmailAuthForm keeps its own separate scroller.                              | `app/account/email.tsx`         |
| D28-011 | Non-transcript Chat guards gain safe-bottom-inset scrolling; transcript scrolling and the pinned authenticated composer remain separate.                      | `app/chat/[id].tsx`             |
| D28-014 | Only Circle privacy pills receive bounded shrink/wrap behavior; generic pills, selection, full labels and 44-point target remain.                             | `app/create.tsx`                |
| D28-018 | Live status/count overlay is bounded by both 14-point media insets and supports wrapping without dropping the full count.                                     | `app/live/[id].tsx`             |
| D28-019 | Current-host leave-confirmation entry invokes `Keyboard.dismiss()` before opening the existing dialog; end authority and cancellation behavior remain.        | `app/live/[id].tsx`             |
| D28-021 | All four PostCard actions use one intentional wrapping rail. Visual counts cap at 99+ while exact values remain accessible.                                   | `components/post-card.tsx`      |
| D28-023 | Unread badge uses intrinsic/minimum height with vertical padding, preserving its 44-point control and exact accessible unread count.                          | `components/activity-badge.tsx` |
| D28-024 | Compact enlarged-text tabs use an inset-aware icon-first/selected-label policy while retaining all four destinations, selection, central Create and no Chats. | `app/(tabs)/_layout.tsx`        |

Six small pure helpers support the width, privacy, overlay, dialog, count and tab policies. Dedicated source tests cover each conditional finding. The independent read-only integration review found **no concrete source defect** across the settled changes and their prior-repair seams.

## Executed checks

| Check                                   | Observed result                     | Boundary                                                                                  |
| --------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| TypeScript and strict unused checks     | Passed                              | Compilation only                                                                          |
| ESLint with zero-warning requirement    | Passed                              | Source diagnostics only                                                                   |
| Full unit/regression suite              | **1,130 tests passed in 222 files** | Includes mocked/source seams; not physical execution                                      |
| Corrected predecessor fixtures          | 28 tests passed in 3 files          | Overlaps the full suite; not added to its total                                           |
| Changed-source Prettier and diff checks | Passed                              | Source formatting only                                                                    |
| API bundle                              | Passed                              | Does not activate providers or publish                                                    |
| Offline database-auditor regressions    | 16 passed, 0 failed                 | Auditor unit tests, not production database mutations                                     |
| Environment-template coverage           | Passed on corrected invocation      | `node scripts/check-env.mjs --mode template`                                              |
| Web, iOS and Android JavaScript exports | Passed                              | Public-only settings; no signed build or installed-device proof                           |
| Protected-file verification             | 214 files unchanged                 | Server/auth/SQL/schema/lockfile/config/assets/workflows and encrypted pipeline boundaries |

Initial failures are retained. The first full run exposed two pre-existing shell test harnesses unable to resolve the newly imported tab helper; both now forward to the real helper without weakening navigation assertions. The predecessor unread test now checks minimum/intrinsic height, vertical padding and absence of fixed height, while retaining exact-count, target and viewer-scope assertions. The combined final command exited 2 only at an unsupported `--template` environment-check argument; all prior individual checks passed, and the declared `--mode template` invocation subsequently passed separately.

## Browser evidence — excluded from product conformance

The auxiliary worker produced a hand-translated DOM/CSS fixture with direct imports of six actual helpers, rather than bundling the actual React Native components. Its copy, container geometry, fonts, events and scroll sizing are not source-equivalent. The initial screenshot and fixture-build artifacts are retained for provenance but **excluded from rendered-layout, browser-keyboard and native acceptance**. No final browser assertion count or product pass is claimed. This does not invalidate the actual source/unit checks; it leaves rendered validation open.

## Physical and keyboard verification

**Not executed.** The immediate blocker is authorization of a workspace on Matts-Air. After access exists, inspect the connected Android phone, available adb tooling, native build and actual loaded source before testing. Machine-level tool installation requires its own specific approval if needed.

The [physical verification protocol](d28-native-verification-20261028.md) covers each conditional ID, the comments aliases and native Email/Chat/Comments/options/host-dialog IME journeys. It requires normal/enlarged text, available compact and landscape layouts, real keyboard visibility, actual control reachability, labels and restoration of temporary display settings. Missing populated or role-specific contexts remain blocked rather than generating production data. No iPhone was offered; iOS physical behavior remains unverified.

Browser focus, CSS text pressure, screenshots, JavaScript exports and a mocked keyboard callback cannot close native Yoga, font-shaping, keyboard/IME, safe-area, touch propagation, media-crop or spoken-accessibility gaps.

## Register and safety

The complete `conditional-repair-register.json` attached to this Manus task retains all 24 canonical IDs and aliases D28-025/026→006,027→007,028/029→008. Current source statuses are repaired, while physical/native gaps remain open. Historical per-owner counts overlap and are not summed into a fictitious total.

No production records, providers, grants, migrations, dependency versions, native identifiers, encrypted upload/publication contracts, API/Metro ports or publication settings were changed. Only the owned invalid auxiliary fixture listener was stopped; the Circles app services were preserved. Canonical save status is appended after the actual Git result; no Version-history card is inferred from a shell exit code.
