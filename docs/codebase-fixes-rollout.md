# Circles — confirmed codebase fixes rollout

## Deployment scope

The reviewed aggregate patch was applied to the active Circles source on 22 October 2026. Before application, the source tree matched the required baseline `a462ce18bf94ba0387ad61af8e2f05c5ac4edf62`, and the patch SHA-256 matched `04d2a8e631417a27bfe9ae842a56901a29e36afc3d08197a5d394574de9c0e4f`. Its staged tree exactly matched private candidate `33285e31c7a70eded7bef7116c75b4ea0880a1f4` / tree `1a3e5286a1bda648b3df282462ed2583dc52d9fd` before deployment-support changes.

Migration `0004_message_receipts_live_host_leases` had already been applied and independently verified. The patch installs the matching SQL, journal and snapshot in source control; it does not reapply the database migration. Existing columns, signing identity, native identifiers, framework/lockfile, hidden scrollbars and the user's simplified bottom navigation are preserved.

The exact API and Metro services were restarted together on fixed ports 3000 and 8081. This makes the updated client/server code available in **mobile/web Preview**. No published production website/backend, signed mobile release or app-store submission is claimed. The project has no configured live published deployment, so hosted production logs are not available; the running API/Metro logs are captured privately and inspected instead.

## Source-confirmed issues addressed

| ID | Applied correction |
|---|---|
| AUTH-001 | Provider-owned native login refresh and authenticated-state observation before navigation. |
| SOC-002 | Stable feed scanning beyond inaccessible private entries. |
| SOC-003 | Idempotent concurrent circle joins that preserve pending and privileged roles. |
| MSG-001 | Newest-message cursor paging and older-history loading. |
| MSG-002 | Delivered-message IDs and monotonic durable read watermarks in conversation transactions. |
| MED-001 | Canonical managed-media URLs and rejection of attacker-origin lookalikes. |
| MED-002 | Admission/concurrency budgets before bounded authenticated-object storage retrieval. |
| LIV-001 | Generation-bound signaling and host-reload renegotiation. |
| LIV-002 | Atomic active-host lease admission/lifecycle with ended history retained. |
| LIV-003 | Terminal access/ended errors stop timers, tracks and peers. |
| LIV-005 | Live discovery performs non-mutating profile lookup. |
| FND-001 | Query failures precede empty/not-found/ended states and expose retry. |
| FND-002 | Comment/live-chat submission is single-flight with busy feedback. |
| PLATFORM-001 | Exact configured-origin parsing shared by OAuth and CORS. |

All 15 original ESLint warnings were corrected without globally disabling rules. This deployment does not claim to resolve all dependency advisories, distributed streaming capacity, or other release recommendations outside those selected findings.

## Post-migration validation

The exact applied candidate passed TypeScript, **138 tests across 24 files**, API compilation and ESLint **0 errors / 0 warnings** in a credential-free source snapshot. These include synthetic/integration regressions for native login state, durable session/logout rejection, message paging/watermarks, URL boundaries/storage budgets, live generation/reload and host admission/terminal teardown. They are not physical-device or real-provider end-to-end results.

Real read-only Preview verification exercised all 14 declared query procedures within the available context: **9 positive public queries and 2 signed-out/anonymous gates passed, with 0 failures; 5 protected/context-dependent positive checks remained incomplete**. Actual browser account inspection returned HTTP 200 with no authenticated user. No fake account/session, conversation, membership, stream or live broadcast was created.

A read-only deployment review found one additional integration mismatch, **REC-001**: the guarded verification tool needed the new live-signal generation field. The production native/web media callers already supplied generation correctly. The verifier correction requires an explicit current generation from trusted inputs, skips unavailable context, and preserves strict incomplete-coverage behavior. Its targeted test evidence, final guest browser checks, platform bundle results and source/CI identities will be recorded in the final validation section after completion.

## Logs and remaining real-context coverage

Pre-deployment retained logs showed repeated session-verification warnings and an existing `circles-ui → media-image → circles-context → circles-ui` require-cycle warning. After restarting the patched services and exercising real public queries, no missing-column/table, database-connection, watcher/memory, unhandled-rejection or uncaught-exception category was observed. Signed-out/expired-credential warnings and the nonfatal import cycle remain distinct from application crashes and ESLint diagnostics. Retained old log tails are not individually timestamped; new log files are scoped to the restarted services.

Full authenticated/native/live E2E is **not complete**. It requires normal test-account sign-in past the CAPTCHA, an authorized iOS/Android development build or simulator/device, and approved existing private-circle/conversation and active host/viewer contexts with current generations. Passing guest checks, mocked session tests and JavaScript bundle exports cannot replace those checks. No unrelated production data was mutated to manufacture fixtures.

## Final validation and source record

After the generation-aware verifier correction and skill synchronization, the **full existing automated suite passes141tests across24files**, TypeScript and API compilation pass, and ESLint reports **0errors/0warnings**. CI now explicitly fails on any ESLint warning as well as errors. The three added verifier regressions explain the increase from138 to141; the focused recovery test file has22passingtests.

All iOS/Android/web JavaScript bundles compiled in a separate credential-free workspace with one Metro worker. The application code/assets match the original applied candidate; subsequent differences are verifier/tests/docs/skill metadata and the public route manifest, not native/media implementation. These are unsigned JavaScript/Hermes bundles, not release binaries or device validation.

Guest browser validation first recorded8passes/3failures/5skips. Investigation traced the navigation failure to a test selector matching decorative icon glyphs, and the two console-error failures to a real optional Preview metadata request for `/manus-routes.json` returning404. The selector was corrected and a static manifest matching all13actual page routes was added (not an invented entity route). Only the three affected cases were rechecked; all passed. Combined case evidence is now **11passes/0failures/5explicit context skips**, retaining original failures for traceability. Navigation, scrolling, public circle/creator detail, signed-out action guards, live lobby, readable query-error retry, and same-origin cross-site iframe reads were exercised without application mutations.

The corrected strict query verifier reports11passed checks,0failed and5incomplete protected/context-dependent positives across14queries, including9successful positive public reads. Strict completion deliberately remainsfalse. The actual browser is signed out; no controlled active stream was available. The host offers desktop execution environments but no accessible authorized native test workspace/device fixture was established. No native E2E claim is made.

Final logs show no missing schema, database-connection, watcher/memory or unhandled-exception category during the observed post-deployment checks. Session-verification warnings are emitted by the existing verifier on signed-out/invalid session values; no successful authentication is inferred. The existing nonfatal require-cycle warning remains and is a separate cleanup recommendation, not one of the resolved ESLint warnings. The optional-manifest console404was corrected and the rechecked browser surfaces have no observed exceptions/console errors/public query failures.

Both repositories are to be saved with preserved histories. The exact resulting commit and actual GitHub CI outcome are recorded in the final deployment verification report rather than guessed or embedded self-referentially in this commit. Full authenticated/native/live E2E remains open; no production publication or store build is claimed.
