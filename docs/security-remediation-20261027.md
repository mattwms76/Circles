# Security remediation and verification — 27 October 2026

## Outcome and scope

The request referred to 31 issues, but the finalized security audit contains **33 unique IDs**. Every ID is retained in `security-remediation-register-20261027.json` and its Markdown counterpart. The result is **17 source-resolved findings, 3 partially remediated findings, 4 upstream-blocked findings, 8 owner/deployment gates and 1 compatibility-maintenance backlog**. This is not a claim that every vulnerability or operational risk is eliminated.

Implementation was isolated from the active Preview in a detached candidate based on local commit `6fa4b1d318a9c82d7e78b368d2203db257d63b3c`, whose tree matched GitHub main `19d078f1a5a23a94965f6526834fd637f9a76984`. Local Node 22.23.4 and pnpm 9.12.0 were used for the final complete validation. Some earlier focused module runs used Node 22.13.0; they are not substituted for the final pinned parent results.

## Implemented repairs

Authentication now validates the trusted OAuth back-channel configuration before production listening and requires a positive source numeric actor for new OAuth session issuance. Email admission is bounded and fails closed when its tracking capacity is exhausted; it remains process-local. Neither ordinary email identity SQL nor Google/provider configuration was activated.

Incomplete sign-out now closes a synchronous credential-admission barrier and persists a non-secret recovery sentinel. Normal token reads, tRPC and standalone HTTP dispatch, session establishment and protected-media credential acquisition fail closed while recovery is incomplete. Final dispatch strips stale bearers and omits browser cookies. Only the private exact logout POST path retains its captured recovery credential/cookie exception. A missing native recovery bearer is not treated as confirmed remote revocation. Outcome UI distinguishes failed revocation, credential deletion, image-cache clearing, protected navigation and sentinel persistence/removal. Actual browser-cookie and native SecureStore behavior remain separate device/provider gates.

Private-feed continuation is derived only from authorized serialized rows, with exact timestamp precision. Private live-card projection and current membership use the shared parent lock and the same transaction client. Media performs signed fetch/decryption outside database locks, then rechecks the current reference and authority under a parent SHARE lock and queues verified bytes synchronously before releasing that lock. Already-enqueued bytes cannot be retroactively revoked.

Raster uploads are structurally decoded and normalized with maintained Sharp under byte/pixel bounds. MP4 uploads remain supported: maintained MP4Box parses bounded complete unfragmented H.264/HEVC video plus supported AAC audio in an isolated resource/time-limited worker. Admission is not transcoding, sample decoding or native playback verification. Fragmented MP4 is explicitly rejected. Source size and normalized size both pass the existing optional platform limit before encryption/storage.

Storage transfer checks exact configured HTTPS object origins, rejects private/mixed DNS answers, pins the selected public address and hostname/TLS identity, refuses redirects, and retains a finite deadline and cancellation through DNS, headers and response-body completion. Approved real object origins must be configured before deployment; missing configuration fails closed rather than accepting an arbitrary signed URL.

The API enforces finite URI/batch, request body, admission, concurrency and deadline budgets before expensive parsing. Narrow optional trusted-proxy configuration, private no-store/security headers and aggregate-only public readiness preserve Preview framing/cookie compatibility. Capture adapters synchronously tear down on inactive/background or hidden/pagehide and require intentional generation-keyed rejoin; physical native/BFCache/WebRTC proof is not claimed.

CI verifies the PGDG signing fingerprint and runs the new isolated security suite. Docker private-material exclusions and database-auditor documentation are aligned with the repository policy and current 27-table scope. Future-only checksum-manifest migration transport, synthetic encrypted recovery and mocked watchdog transition drills are executable, but none is activated against production. Applied SQL history and native identity/configuration are preserved.

## Verification

The final local runner completed **20 categories**: **19 passed**, and the dependency audit deliberately remained failed because active upstream advisories remain. `all_gates_passed=false` is retained in machine-readable evidence; `non_advisory_gates_passed=true` is not relabelled audit-clean.

- Frozen install, strict TypeScript with unused-code checks, zero-warning full lint, tracked-source formatting, both environment modes, security-auditor tests, fixture-runner tests and API build passed.
- Full unit suite: **928 tests in 181 files; zero failed, errored or skipped tests**.
- Fresh disposable PG17 HTTP suites: Circle Home **11**, Activity **12**, Moderation **7**, authority **13**, security media-release/atomic transport **2**. All fixtures were loopback-only and cleaned up.
- Separate PG17 identity role/RLS, real-store mapping/races and HTTP/durable-session drills passed. The HTTP identity drill has **12 cases** with an explicitly in-process provider mock; it is not a real provider/account check.
- Web, iOS and Android JavaScript exports passed. These are not signed native builds or installed device journeys.
- Checksums of **29 historical SQL/migration/native-configuration files** matched the baseline, with zero immutable drift.

The isolated authority fixtures prove private-candidate cursor secrecy beyond 2,000 private search candidates, removal-wins versus reader-first live-card projection, no network under private-media locks and byte enqueue before a waiting removal. The security fixture now executes the actual future migration transport against a SHA-pinned synthetic manifest and proves a failing final statement leaves no partial table/history residue. Synthetic auth/storage seams remain explicitly labelled.

The initial integration review found startup/config, upload compatibility, logout transport and proof gaps; those were repaired. The final review's standalone HTTP bypass was closed with direct dispatch-race, retained-cookie, exact logout-recovery and denied session-establishment tests. Earlier failed static/unit attempts are preserved outside Git rather than overwritten as success.

## Dependency outcome

Direct runtime Zod resolves to **4.6.7**, ESLint to **9.39.5**, and Expo-scoped structured-clone to **1.4.0**. Maintained server-only Sharp **0.35.5** and MP4Box **2.5.0** were added with actual consumer tests. There are **74 direct declarations** after both additions; no broad framework/native upgrade was attempted.

A fresh audit still exits 1 with four families: transitive Expo CLI Zod (**high**), node-forge (**high**, no established patched compatible release), http-cache-semantics (**high**, no established patched compatible release), and decode-uri-component (**moderate**, fixed upstream version not compatible with the current CommonJS parent). No decoder/crypto replacement, fake bridge, audit suppression or forced native major upgrade was introduced. Deprecated esbuild-kit, the ESLint supported-major transition and general dependency freshness remain explicit compatibility work.

## Outstanding owner and operational gates

Actor-aware database RLS, nonprivileged connection bootstrap/pooler transition, legacy public-schema privacy decisions, actual coordinated credential rotation/revocation, production migration transport adoption, full provider/media recovery, independent freshness monitoring/alert delivery and exact deployment proxy configuration remain owner-controlled gates. Proposed SQL is preparation-only. The current server-role RLS boundary still depends on server resource authorization.

There was no live SQL/grant/role/row change, provider/account activation, credential rotation, scheduler modification, service restart, deployment or publication in this remediation. The installed approved admin security bundle remains separate and unchanged; ordinary identity/optional feature-reader activation stays gated. Separate Circles-Admin source and consumer-private boundaries were preserved.

Source-saving and automatic exact-revision CI receipts are recorded separately after acceptance. The known Manus-managed Git transport/checkpoint blocker is not converted into a claimed checkpoint merely because the authorized GitHub mirror accepts source.
