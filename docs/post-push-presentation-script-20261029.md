# Circles: Post-Push Verification and Recovery Update

**Format:** Text-only speaking script, approximately five minutes.
**Evidence date:** 29 October 2026.
**Historical report snapshot:** `c7ad369`, with Preview then on `20652cb`.
**CI test correction:** GitHub commit `06bbc71`.

## 1. Opening — correct source is not the same as a working service

**Speaker:**

“Today’s update answers two separate questions: are the People recommendations and recent design fixes present and tested, and can the live service actually deliver those results?

The post-push report gave us strong local implementation evidence. It also found two operational blockers: a rejected PostgreSQL credential and a machine-specific path in a GitHub CI test. Our recovery work keeps those findings separate instead of treating a successful build as proof that the live app works.”

**Visual cue:** Two headings: “Implementation verified” and “Operational readiness.”

## 2. People to know — verified recommendation behavior

**Speaker:**

“At the report’s source snapshot, all 26 focused People checks and all six real HTTP-to-PostgreSQL integration cases passed. The full local suite passed 1,163 tests across 226 files, together with TypeScript, lint, formatting and the API build.

The recommendations prioritize people not already followed, then rank candidates using shared interests and directed two-hop follow relationships, with deterministic ID tie-breaking. The checks covered contrasting viewers, cold starts, malformed or duplicate interest data, search, privacy and static pagination.

Importantly, public responses did not reveal private interests, recommendation scores or intermediary identities. The test data was synthetic and isolated; we did not change production profiles or follows.”

**Visual cue:** “26 focused • 6 HTTP/PostgreSQL • 1,163 historical full-suite tests.” Label these as overlapping—not additive—counts.

## 3. Design fixes — included, with native limits still open

**Speaker:**

“The report confirmed that all 24 recent design source repairs were retained: 13 confirmed issues and 11 conditional remediations. Their 86 dedicated cases passed within the full regression suite.

These include comments-sheet overflow containment, compact chat attachment sizing, enlarged-text People rows, scrollable short-height dialogs, accessible unread counts and clearer per-card onboarding progress. The later helper-consolidation review found no newly confirmed behavioral regression in the reviewed changes.

This is source and automated-test evidence, not physical-device certification. Android and iOS keyboard, IME, large native-font, safe-area and screen-reader verification remain open.”

**Visual cue:** “24 retained repairs = 13 confirmed + 11 conditional.” Put “Physical-device checks not executed” underneath.

## 4. PostgreSQL recovery — stored values remain rejected

**Speaker:**

“We reused the existing stored configuration as requested, without displaying or replacing secrets. The stored connection passes the app’s exact-target and certificate-verification checks and uses the existing active connection principal—not the prepared role cutover.

However, a fresh connection still returns PostgreSQL error 28P01. The API process is alive, but database readiness remains unavailable. The running API already has that same stored database setting, so restarting it with the same rejected credential would not repair authentication.

Stored Supabase HTTP API keys are not PostgreSQL passwords and cannot substitute for one. We did not guess credentials, reset the database password, rotate unrelated keys or restart services after the failed preflight. Recovery still needs a current valid database connection string through protected input, or a separately authorized owner reset if that password is unavailable.”

**Visual cue:** “Stored URL tested → 28P01 → readiness still blocked.” Never display a connection string or key.

## 5. CI correction — portable evidence and unchanged recovery assertions

**Speaker:**

“The CI test previously wrote its evidence under the hard-coded path /home/ubuntu. That worked in this sandbox but failed on GitHub’s runner.

The correction moves that evidence into the test’s own disposable temporary directory. It preserves private file permissions, process-replacement and restored-health assertions, and verifies cleanup.

The corrected canonical watchdog suite passed all 13 cases, including an unprivileged-user run without write access to /home/ubuntu. The GitHub source’s 14-case watchdog suite also passed locally. These are different source revisions, not inconsistent counts.

The narrow test-only fix is now pushed to GitHub as commit 06bbc71. It preserves GitHub’s helper-consolidation history without overwriting the separately advanced canonical audit work.”

**Visual cue:** Before: “machine-specific home directory.” After: “owned temporary directory, private permissions, cleanup.”

## 6. Evidence boundaries and remaining work

**Speaker:**

“We should not add focused and design-specific cases to a full-suite total, or call local test success a hosted CI result. Nor does a passing container check establish database authentication.

Ranking can change between cursor requests, so interest or follow changes require a refresh rather than a frozen-snapshot assumption. Production-scale performance and real authenticated native journeys were not benchmarked or executed here.

After a valid database value is available, the next steps are a fresh restricted-role readiness check, a controlled API-only environment reload through existing ownership, and read-only People requests. Healthy Metro should be preserved. Prepared migrations and provider changes remain separate approval gates.”

**Visual cue:** “Source • Hosted CI • Live database • Physical device”—four separate evidence categories.

## 7. Closing — current recovery status

**Speaker:**

“The implementation and design source evidence remains strong, and the machine-specific watchdog test path has been corrected and pushed. The live database blocker remains unresolved because the stored credential is still rejected.”

<!-- CI_STATUS_BEGIN -->
“Hosted CI has now passed for the exact fix commit, 06bbc71. The environment, TypeScript, tests and API-build job succeeded, as did the isolated People HTTP-to-PostgreSQL step and all three Android, iOS and web JavaScript bundle jobs. This closes the reported CI path blocker; it does not establish live database authentication or a signed native release.”
<!-- CI_STATUS_END -->

“The release decision must therefore keep database readiness and physical-device verification open. We have narrowed the next action: supply a valid database credential through protected handling, then prove the live People data path—not merely process health.”

**Visual cue:** Mark “CI test source corrected” complete; leave “Live database recovered” and “Physical-device verification” open. Mark hosted CI passed for the exact fix commit; do not mark live readiness recovered.

---

## Presenter reference

Historical counts and findings come from the [post-push verification report](post-push-verification-report-20261029.md). The stored-credential preflight (retained in private task evidence) records the continuing authentication rejection without secrets. The exact [GitHub CI run](https://github.com/mattwms76/Circles/actions/runs/40909720148) is separate from local validation. This is a speaking script, not a generated slide deck or a deployment approval.
