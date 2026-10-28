# Record–Preview–Publish integration and managed Git recovery

The final reconciled source passed all 1,044 unit/regression tests in 198 files, TypeScript, zero-warning lint, changed-source formatting, and API compilation on 28 October 2026. It preserves all nine newer canonical database/security commits alongside the GitHub recording/security/UI source rather than replacing either history. No database migrations, fixture posts in the shared database, provider activation, credential rotation, or application publication are part of this work.

## Available end-to-end boundaries

The isolated PostgreSQL 17 publication suite now exercises an actual 1280×720 H.264/AAC MP4 through loopback HTTP `social.upload`, authoritative MP4 inspection, production media encryption, canonical upload recording, and idempotent `social.createPost`. It verifies exact decrypted bytes, actor-owned attachment metadata, one object write, one post, one receipt hash, and one media claim after identical retry. Its explicit external seam is an in-memory object-storage capture, not a real provider upload. Authentication uses synthetic fixture actors and all SQL writes occur only in a runner-created disposable database.

The publication suite passed 11 tests, including the historical/current generated receipt-identity contracts, concurrent retries, changed-payload conflict, actor/membership/media ownership, deletion tombstones, and missing receipt schema. Newly added rejection paths cover declared MOV, truncated MP4, a synthetic 30.001-second clip under the 30-second selection, unauthenticated upload, and an actual request above 20 MiB. The same real one-second clip succeeds under a 60-second selection; this is not a physical 60-second recording claim.

A private rendered harness uses the real native recorder, local preview, and composer source with explicit camera/video/file/permissions/AppState and tRPC client seams. Its two journeys cover default 30-second preparation, duplicate Stop, camera release before preview, Retake cleanup/caption preservation, Use into composer, publish-time file read, ambiguous delivery followed by one-upload/one-read stable-payload retry, and background/unmount late-result cleanup without publication. It passed alongside 49 existing focused client tests. A distinct rendered account-switch late-completion journey remains unobserved.

Existing security-media HTTP tests and A26 conversation/authority SQL tests also passed. Read-only checks of the public preview, API health, actual database-backed query, and the reconciled current database/OAuth/publication metadata succeeded. The real browser composer correctly requires sign-in for a guest.

## Managed Git recovery

The ordinary fetch trace receives `NAK` while expecting a side-band pack stream and fails with `bad band #78` / `bad pack header`. Authentication succeeds and Git advertisement/result requests return HTTP 200. Disabling commit negotiation for that fetch succeeds; protocol-v0 selection alone did not repair it.

The verified compatibility setting is now project-local only:

```sh
git config --local fetch.negotiationAlgorithm noop
git fetch origin main
```

Git documents that `noop` skips negotiation and can transfer a larger pack. It does not replace repository authorization or permit history rewriting. No remote, credential helper, upstream, hook, global Git configuration, application secret, or publication setting changed. The original local negotiator setting was absent. To remove the workaround after the underlying server negotiation path is repaired, use `git config --local --unset fetch.negotiationAlgorithm`.

The fetched canonical history contained nine newer database/security commits. The reconciliation retains the newer exact catalog/role/readiness contracts and receipt identity compatibility alongside GitHub's recording, UI, email and security source. Independent review identified a quoted-SQL session-control lexer bypass. The targeted correction now recognizes ordinary quoted identifiers, refuses unsupported Unicode-escaped identifiers, and rejects executable DO/EXECUTE without rejecting benign strings, comments, or quoted columns. All 12 focused guard cases and the disposable native PG17 drill passed; final HTTP suites passed 11 publication, 2 security-media, and 14 conversation/authority tests with each disposable fixture removed. Historical failed evidence is retained rather than relabeled as a pass.

Saving is a normal canonical main push after current-history integration and validation. A push and a returned Manus checkpoint receipt are separate facts; publication remains disabled. The final checkpoint SHA and final post-fix test conclusions belong in the delivered outcome evidence, not an invented version claim here.

## Not proven by these automated tests

Physical iOS/Android camera and microphone permissions, encoder/player behavior, front/back hardware switching, native interruptions/low storage, a signed build, real authenticated account traversal, a distinct rendered account-switch interruption, actual transport loss, and a real external object-store/provider transfer remain open. These require an authorized device/build/account and provider journey. No claim that every native/provider condition works follows from mocked device seams or disposable SQL fixtures.

## Official Git references

- [Git configuration: fetch.negotiationAlgorithm](https://git-scm.com/docs/git-config)
- [Git fetch](https://git-scm.com/docs/git-fetch)

The sanitized trace can be submitted through [Manus help](https://help.manus.im) for a provider-side multi-round negotiation repair; the repository-local compatibility workaround does not claim that server repair occurred.
