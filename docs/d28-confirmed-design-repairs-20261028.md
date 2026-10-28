# Circles — 13 confirmed D28 design repairs

All 13 confirmed-source findings from the 28 October audit are implemented. The first repair wave addressed comments-sheet containment (D28-006) and compact Chat attachment sizing (D28-010). The separate repair register retains all 24 canonical IDs and five aliases; the original audit remains immutable. The 11 conditional findings remain open.

## Implemented changes

| ID | Source repair |
| --- | --- |
| D28-006 | Header, loading/error/empty/content and comment composer share one naturally bounded, shrinkable full-sheet scroll surface. |
| D28-010 | Photo/video dimensions use post-inset transcript width, the 80% bubble constraint, padding **and both photo borders**. The preferred 120-point minimum cannot exceed the actual attachment budget. |
| D28-001 | Functional Create-circle glyph uses the existing accessible action token rather than decorative coral. |
| D28-002 | Initial/refetch/continuation Circle retries show matching busy/disabled state; optional Empty action props preserve other consumers. |
| D28-003 | Directory copy distinguishes “1 circle” from plural results. |
| D28-008 | Own Profile, confirmation and Create distinguish checking/retryable auth errors from a settled guest; authentication authority and other-person profiles remain unchanged. |
| D28-012 | Authorized Feed/Members/Manage pages retain content on recoverable errors with the matching retry. Explicit authorization loss remains fail-closed. |
| D28-013 | Circle Manage exposes a named full-moment disclosure before removal, scoped to current account/circle/authority. |
| D28-015 | Theme Lab has a centered, readable 960-point content cap without a global theme change. |
| D28-016 | Primary Live detail title wraps completely instead of a three-line cap. |
| D28-017 | Live media-error badge says “VIDEO UNAVAILABLE”; pending remains “CONNECTING.” |
| D28-020 | Only the initiating recommendation shows membership progress. Competing named actions stay disabled; old-scope settlement cannot clear newer progress. |
| D28-022 | Visual unread badge stays “99+”; its accessible label retains the exact validated current-account count. |

## Verified checks

The final full regression run passed **1,097 tests in 211 files**. This includes **53 dedicated D28 cases**, not 53 additional cases to add to the total. TypeScript/strict unused checks, zero-warning lint, changed-source formatting and API build passed. The unmodified environment-template check, 16 database-audit utility cases and 10 register-validator utility cases passed separately. The [independent integration review](/home/ubuntu/circles-d28-confirmed-fixes-20261028/evidence/integration-review.md) found no remaining source integration defects; its six repeated D28-012 cases are not added to the totals.

Actual final-source **web, iOS and Android JavaScript exports passed** using public-only build settings. They are JavaScript compilation evidence, not signed native releases, Hermes bytecode validation or physical-device evidence.

The isolated priority fixture produced **79 passing DOM assertions, zero failures**, across 12 cases: actual PostCard comments loading/error/empty/content at 320×640 and 320×360, plus four extracted Chat media geometry configurations. The 320-pixel compact Chat case includes a 44-pixel lateral inset; the extreme 180-pixel case checks attachment dimensions only, not full transcript usability.

The browser caught a residual photo-border allowance: its bubble measured 187 pixels inside a 185.59375-pixel wrapper. The final helper reserves both border pixels; the corrected bubble measures 185.59375 pixels, and its 157-pixel photo/video attachments fit. This failure and the correction remain in separate evidence records.

At short height, the comments sheet is capped to 306 pixels (85% of 360), remains nonzero, and provides one scroll path to retry/composer/close. Header and composer need not be simultaneously visible at every scroll position; they remain reachable. Initial fixture build/timing/reload failures and the obsolete legacy test alias-resolution failure are retained rather than relabeled as passes. The messaging harness now forwards the new helper to its real implementation without removing assertions.

## Render and device boundaries

Comments use the actual PostCard and shared UI through React Native Web with explicit inert auth/query/router/media/inset/icon adapters. Chat uses a documented extracted bubble block plus the actual helper/shared UI; its labeled photo/video visuals are stubs, not real decoding or playback. No external/auth/data requests were recorded. Annotated captures may include browser inspection overlays.

These checks do **not** establish native Yoga/font shaping, keyboard/IME clearance, physical safe areas, native screen-reader speech, touch propagation, authenticated production journeys or real media/provider behavior. Programmatic browser scrolling is not a native gesture test. Comments source measurements retained through the final helper-only correction remain valid because the PostCard source hash is unchanged.

## Preserved scope

All 214 protected baseline files remain byte-identical: no server/API/schema/migration/private grants, dependencies, workflows, native identity/configuration, assets or operational script changes. API3000 and Metro8081 remain healthy without restart. The temporary fixture listener is removed after evidence capture.

No real accounts/posts/memberships/streams, live SQL, provider activation, secret rotation, backup/schedule changes or app publication occurred. Source saving is a separate normal canonical Git operation; the exact accepted SHA and platform receipt status are recorded in the external delivery metadata after the push. No automatic GitHub mirror is configured.

## Still open

D28-004/005/007/009/011/014/018/019/021/023/024 remain open. D28-025/026 inherit the comments source repair but retain unobserved native/keyboard conditions. D28-027 remains linked to the unselected options-card risk. D28-028/029 inherit the auth-presentation repair under D28-008. Original classifications are not silently promoted to rendered or native conformance.

The [complete repair register](/home/ubuntu/circles-d28-confirmed-fixes-20261028/repair-register.json) preserves every original canonical finding, alias, recommendation and evidence gap. Register validation is metadata-only; it does not certify native conformance or platform checkpoint acceptance.
