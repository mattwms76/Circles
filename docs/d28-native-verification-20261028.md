# Physical Android and keyboard verification

## Current status

**NOT EXECUTED.** Matt selected an Android phone connected through Matts-Air on 28 October 2026 at 17:53 UTC. Fresh device discovery at 18:01 UTC reports Matts-Air online but `needs_workspace`, with no authorized folder. The phone model, OS, USB authorization, installed app/build and source actually running on the phone have not been inspected. Opening a Mac workspace is the immediate prerequisite; no iPhone was offered. This protocol is preparation, not a test result.

Use the repaired Circles native development build, not browser Preview or Expo Go as native WebRTC evidence. Since these repairs change JavaScript only, an existing compatible development build may be usable if it demonstrably loads the current repaired Metro source. A bundled release running older JavaScript does not qualify. Confirm the source commit and loaded bundle before testing; do not infer them from an installed app icon.

## Access and safety

1. Select an authorized Circles/testing workspace on Matts-Air in Manus. Keep the Android phone connected and unlocked; enable USB debugging and accept its authorization prompt.
2. Inspect existing `adb` resolution/version and connected-device state. If adb is absent or fails, diagnose first and obtain permission for that specific machine-level installation; do not silently install Android Studio, Java or a new SDK.
3. If multiple phones are connected, obtain the intended target before issuing commands. Record model, Android/API version, logical display size/density, orientation, font scale, app package/version, native development-build identity and loaded source. Keep serials and raw UI dumps private.
4. Use an existing authorized non-mutating context. Do not sign up, fabricate production users/posts/circles/counts, change provider settings, mark updates read, Follow/Join, Report/Remove, Send/Publish or start/end a real broadcast to produce a test case. Unavailable populated or role-specific contexts are blocked/skipped, never passes.
5. Capture original font/display settings before any permitted pressure test. Restore them and original orientation in cleanup. Avoid screenshots of passwords or private message bodies; redact unnecessary personal information before sharing.

## Per-finding physical cases

Run normal portrait first, then enlarged system text and short landscape where supported. Record actual logical width: a phone-sized browser or a screenshot resized to 320 pixels does not reproduce a320-point native layout. Test narrower logical width only through an explicitly reversible device setting/window configuration, retaining its baseline.

| ID                      | Non-mutating physical journey                                                                              | Required observation                                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D28-004                 | Discover → Live with existing authorized entries; portrait and wider/landscape view                        | Thumbnail frame remains 16:9, card/title/host control reachable. Check vertically important existing imagery; no new stream is created.                                                                                                   |
| D28-005                 | Discover → People; existing long identity and available Your profile/Follow-state rows                     | At measured compact card width ≤ 320, identity and action have intentional separate rows, full name remains reachable,48-point action is not squeezed. Do not activate Follow.                                                            |
| D28-007 / alias D28-027 | Existing own moment → options; enlarged text and short available height                                    | Report/Remove/Close are all scroll-reachable and visually contained. Close/AndroidBack only; never Report/Remove.                                                                                                                         |
| D28-009                 | Existing account/email checking, error or guest-proof state, when legitimately available                   | Guard copy and recovery controls can scroll without overlap; authenticated EmailAuthForm retains its separate scroller. Do not manufacture provider errors or submit credentials.                                                         |
| D28-011                 | Chat guest/auth-error/unavailable guard when available, then existing authorized conversation              | Guard recovery can scroll; transcript remains separately scrollable and authenticated composer stays pinned. Never send a message.                                                                                                        |
| D28-014                 | Create → Circle → Public/Private local draft choices                                                       | Privacy labels wrap inside their pill without crossing row edges; icon/selected semantics/minimum target remain intact. Never create/publish.                                                                                             |
| D28-018                 | Already-authorized controlled Live context with status/count, if supplied                                  | Status and full accessible viewer count stay within both media insets; text wraps without right clipping. Do not create/join a real stream solely for coverage.                                                                           |
| D28-019                 | Current host’s supplied controlled context: focus unsent chat draft → open End/Leave confirmation → Cancel | Native IME dismisses before dialog is presented; all dialog actions are reachable; Cancel preserves session/draft and does not end/leave. If no controlled host context exists, block this case.                                          |
| D28-021                 | Existing moment with multi-digit counts → enlarge text                                                     | All four actions remain individually reachable, rail wraps intentionally, visible counts cap at 99+ while native accessible metadata retains exact values. Do not Like/Share/Save merely to generate data.                                |
| D28-023                 | Existing unread Updates count → inspect bell at normal/enlarged text                                       | Badge grows intrinsically without clipping into adjacent controls, target remains ≥ 44 points and exact count is retained; do not mark activity read.                                                                                     |
| D28-024                 | Home/Discover/Circles/Profile navigation at compact available width ≤ 360 and font scale ≥ 1.5             | Icon-first selected-label treatment is deliberate; all four destinations and central Create remain accessible, current selection is correct, and Chats remains absent. Draft-only Create may be opened then cancelled without publishing. |

## Keyboard and IME cases

- **Email:** when an actual enabled form is legitimately available, focus Email, use native Next to focus Password, inspect keyboard clearance and scroll to required controls, then Cancel/Back without submitting. Do not capture password contents. If the feature/form is unavailable, record that gate.
- **Chat:** focus an existing authorized multiline composer, enter an unsent test draft only if it does not overwrite an existing user draft, expand multiple lines, show/hide/refocus IME, rotate where permitted, and verify attachment/send affordances remain reachable. Do not Send/upload. Restore original draft and orientation.
- **Comments (D28-006 plus aliasesD28-025/026):** open existing comments, focus an unsent input, inspect header, scrollable loading/empty/error/content middle and composer under short keyboard height. Close without posting; unavailable loading/error variants are unexecuted rather than artificially passed.
- **Options:** open existing options while keyboard is or was focused where legitimately possible; verify contained scroll recovery and safe Close/Back behavior without destructive actions.
- **Live host (D28-019):** inspect actual IME-dismiss-before-confirmation and Cancel behavior only in the supplied current authorized controlled host context. A mocked `Keyboard.dismiss` callback, DOM focus or synthetic Escape is not this test.

Native accessibility hierarchy inspection can verify labels, selection and target metadata. TalkBack speech must be separately observed before claiming spoken output. Browser Tab/Escape tests are browser keyboard evidence only and cannot close native IME cases.

## Result template

For each run record: exact source/build, model/OS, logical viewport/density, actual font scale, orientation, keyboard/IME type and visibility, inset/navigation mode, role/context, action sequence, pass/fail/blocked/skipped, observation and screenshot/video reference. Record source/runtime differences and cleanup outcomes.

Every case currently has status **BLOCKED — NOT EXECUTED: authorized Matts-Air workspace required**. No physical pass/fail count, native keyboard clearance, touch propagation, font shaping, media crop or assistive speech is claimed.
