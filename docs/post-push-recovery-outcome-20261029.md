# Circles blocker recovery — historical outcome snapshot

**29 October 2026 — snapshot before the complete source-history synchronization.**

The receipts below apply to GitHub `06bbc71` and canonical `569ed51`, as explicitly identified. They do not predeclare validation of the later combined merge.

## Summary

| Requested work | Outcome |
|---|---|
| Reuse stored PostgreSQL values and restore People requests | **Stored values reused; recovery still blocked.** Fresh verified-TLS authentication returns `28P01`. No password reset, credential replacement or service restart was performed. |
| Fix GitHub CI's hard-coded watchdog evidence path | **Fixed and pushed. Exact-commit GitHub CI passed.** |
| Produce a presentation script | **Complete.** Seven speaking sections, approximately five minutes, with historical evidence and current outcomes distinguished. |

## CI fix — verified remotely

The test-only GitHub commit is [`06bbc710b78ec6c2a43233086275188210d689aa`](https://github.com/mattwms76/Circles/commit/06bbc710b78ec6c2a43233086275188210d689aa).

The crash-recovery test now writes its JSON evidence under its own existing `mkdtemp` directory, not `/home/ubuntu`. It retains process-replacement, generation and restored-health assertions; verifies containment, `0700` directory and `0600` file permissions; and verifies removal of both the evidence and temporary root.

[GitHub CI run 40909720148](https://github.com/mattwms76/Circles/actions/runs/40909720148) completed successfully for that exact commit. Its environment/types/tests/API-build job, isolated People recommendation HTTP/PostgreSQL step, and Android, iOS and web JavaScript bundle jobs passed. JavaScript bundle compilation is not a signed native release or physical-device test.

Local verification also passed:

- Canonical source: **1,188 tests in 241 files**, strict types/unused checks, zero-warning lint, formatting and API build.
- Canonical watchdog suite: **13/13**, including execution as an unprivileged user without write access to `/home/ubuntu`.
- GitHub-source watchdog suite: **14/14**, plus types, focused lint and formatting.

These totals refer to different preserved source histories and should not be added together. The narrow fix and recovery notes were also saved to canonical main as `569ed51b5916ee0b26532be922d222004fed68b0`; the Git push was accepted, while an independent Manus Version-history receipt was not observed. Existing canonical audit changes and GitHub helper-consolidation work were not overwritten, merged wholesale or force-pushed.

## PostgreSQL — why stored values cannot close the blocker

The existing stored `SUPABASE_DATABASE_URL` was loaded through trusted runtime synchronization and tested with the application's exact-target, certificate-verified connection helper. The target validates, the password is present, and the login is the existing active connection principal rather than the prepared app-login cutover. No template placeholder or surrounding password whitespace was detected.

Authentication still fails with `28P01`. The running API already uses the same stored URL. API health returns **200**, but readiness returns **503**; process liveness is not database readiness. The watchdog correctly avoids restart churn for this dependency failure.

The stored Supabase Auth URL and publishable key are HTTP authentication settings, not PostgreSQL passwords. They cannot replace a database password. Reusing the same rejected value or restarting with it cannot establish a successful connection.

### Safe next steps

1. Obtain a **current valid database connection string/password** for the existing database and active login. If the current password is unavailable, a provider-owner password reset requires separate authorization because other database consumers may also depend on it.
2. Supply the connection string through **protected input**, not chat or Git. Choose the intended environment; Preview/development and production scopes are distinct. Special characters in the password must be correctly URL-encoded. Do not change database roles or substitute an API key.
3. After saving, refresh trusted runtime and require a successful bounded read-only connection and restricted-role readiness preflight. Leave services untouched if preflight fails.
4. Arrange a controlled, supervisor-aware environment reload. Merely killing the API child is not enough if the watchdog would respawn it with its old inherited environment. Preserve healthy Metro where the existing manager supports it; do not invent an unsupported reload command.
5. Repeat `/api/ready` and actual same-origin `social.profilesPage` reads, retaining only status/shape evidence. Do not create production profiles, follows or posts to pass the test. Prepared migrations, role/provider cutovers and publication remain separate gates.

The stored credential was not changed, guessed or printed. No database reset, prepared SQL activation, signing/media-key rotation, provider change or publication was performed.

## Presentation and remaining evidence

The [presentation script](post-push-presentation-script-20261029.md) summarizes the historical `c7ad369` report: 26 focused People checks, six isolated HTTP/PostgreSQL cases, 1,163 historical full-suite tests, and all 24 design source fixes with 86 dedicated cases. Those counts overlap. Its closing section records the new green CI result while retaining the unresolved database blocker.

Physical Android/iOS, keyboard/IME, enlarged native-font, safe-area, screen-reader and production-scale performance verification remain unexecuted. Ranking can change between page requests; refresh after interest/follow changes rather than assuming an immutable snapshot. Green CI does not close any of these live/native evidence gaps.
