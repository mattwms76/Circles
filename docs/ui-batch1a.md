# UI Batch 1A — accessibility and media resilience

The shared Button now supplies an explicit semantic name, button role and busy/disabled state. Pending presses are blocked; the two moderator actions retain stable accessible names while visible progress text changes. Shared Input derives its name from an explicit accessibility label, visible field label or placeholder. These are component contracts, not a claim that every caller has unique perfect wording.

Failed images preserve the caller's error callback and render a safe fallback; Avatars render initials. Source, candidate-list and account changes reset failed state. Protected native single/array media candidates reuse the current-account token authority and remain idle while that exact request bearer is pending. No protected request is initiated merely to render a fallback, and numeric/public sources remain supported. Tests use canonical synthetic encrypted-upload URLs; the authorization classifier was not relaxed.

## Measured pairs

| Foreground / background | WCAG contrast |
| --- | ---: |
| Secondary `#4D5948` / background `#F9F8F5` | 6.97:1 |
| Secondary `#4D5948` / white paper | 7.40:1 |
| Secondary `#4D5948` / sage `#E9EEE5` | 6.28:1 |
| Secondary `#4D5948` / soft `#FFF0EB` | 6.66:1 |
| White primary text/spinner / action `#A53728` | 6.61:1 |
| White primary text/spinner / pressed/busy/disabled action `#7D2B21` | 9.38:1 |

All listed normal-text pairs exceed 4.5:1. Shared inactive tab label/icon and secondary tokens use the updated contrast treatment. Signature coral remains a decorative brand accent rather than being silently replaced everywhere.

## Evidence and remaining scope

Pure helpers, actual Button element props with native primitives mocked, protected array/current-account behavior, callback/fallback intent and contrast math have deterministic regressions. The full current unit suite, TypeScript and zero-warning lint pass. These checks do not certify a mounted accessibility tree, real VoiceOver/TalkBack, signed iOS/Android rendering or authenticated media on a device.

This addresses the shared mechanisms for I-01/I-02/I-03/I-04/I-10 and only the shared primary-control portion of I-35. Theme Lab/Messages/Live or other route-local status colors, shared header/safe-area Batch 1B and other historical layout findings remain open for their separately scoped work. No bottom navigation, native app identifier, font-scaling policy, hidden scrollbar behavior or media authorization was replaced.

Exact-source remote verification: CI 39986196687 and container 39986196730 passed on the identical canonical/GitHub implementation tree. No native assistive-tech or mounted accessibility-tree proof is implied.
