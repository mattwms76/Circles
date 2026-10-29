# Circles post-push verification — historical snapshot

**Checked:** 29 October 2026.
**Latest GitHub source tested:** [`c7ad36904b69de0a4dea3d96f7a0bb6200cf0db4`](https://github.com/mattwms76/Circles/commit/c7ad36904b69de0a4dea3d96f7a0bb6200cf0db4).
**Previous pushed version / running preview source:** [`20652cb7f8877a8e92e115b0039691902d8dc783`](https://github.com/mattwms76/Circles/commit/20652cb7f8877a8e92e115b0039691902d8dc783).

## Overall result

**The recommendation implementation and all 24 recent design source repairs are included and pass local verification. The feature is not currently working end-to-end in the live preview, and GitHub CI is not green.** Two independently confirmed blockers remain:

1. **Live database authentication:** API health returns 200, but readiness returns 503 and `social.profilesPage` fails. A fresh, certificate-verified connection with the current configured credential is rejected with PostgreSQL `28P01` (invalid password).
2. **CI test portability:** both reviewed CI runs fail one watchdog test because it writes evidence to a hard-coded `/home/ubuntu` directory that is not writable on GitHub's runner.

These are not evidence of a failed ranking calculation or a missing design repair. They still prevent an unconditional “everything works” result.

## 1. People to know

Fresh testing used the exact latest GitHub tree in an isolated worktree, not a modified approximation. The dependency lockfile is unchanged from the preview. Tests used synthetic actors and a disposable local PostgreSQL 17 cluster; no production interests, follows, profiles, memberships or posts were created or changed.

| Check | Fresh result | Boundary |
|---|---:|---|
| Focused People, invalidation, onboarding and Discover contracts | **26/26 tests passed** | Source/pure/component-mock tests |
| Real HTTP → tRPC → service → PostgreSQL recommendation suite | **6/6 tests passed** | Actual SQL and HTTP with isolated fixture authentication |
| Latest full regression suite | **1,163/1,163 tests passed in 226 files** | Local latest-source suite |
| TypeScript and strict unused checks | **Passed** | Latest source |
| Zero-warning lint | **Passed** | Latest source |
| Source formatting | **Passed** | Latest source |
| API build | **Passed** | Compilation, not deployment |

The focused People tests and design tests below overlap the full regression suite; their counts are not additional unique tests to add to 1,163.

### Ranking and safety verified

Authenticated results exclude the viewer and prioritize profiles not already followed. Within each followed/unfollowed group, the score is:

```text
100 × distinct shared allowlisted interests
+ 10 × min(distinct directed two-hop follow intermediaries, 9)
```

Numeric user ID breaks ties. Two-hop means viewer → followed account → candidate, not necessarily a mutual follow. Guest results retain deterministic ID ordering.

The six HTTP/PostgreSQL cases cover contrasting viewers, cold start, shared-interest priority, the graph-score cap, directly followed fallback, duplicate/unknown/malformed interest data, guest behavior, name/handle search, complete static cursor traversal and invalid/self/search-ineligible cursor rejection. Public DTOs do not expose raw interests, scores or intermediary identities. Interest saves and follow actions retain the account-fenced recommendation invalidation wiring.

**Limits:** ranking may change between cursor-page requests; refresh is required after interest/follow changes rather than assuming an immutable snapshot. No production-scale performance benchmark, real OAuth login, physical-device journey or signed build was performed. The successful local fixture does not certify live database health.

The detailed People report (task-local evidence; not included in the repository) and emitted metrics (task-local evidence; not included in the repository) document exact commands, coverage and fixture cleanup.

## 2. Recent design repairs are included

Both repair commits remain ancestors of latest GitHub main:

- `dbef256`: the **13 confirmed** source repairs.
- `e1780a8`: the **11 conditional** source remediations.

All **24 canonical repairs, D28-001 through D28-024**, retain their owned implementation and dedicated test artifacts. Their **24 dedicated test files contain 86 passing cases** in the fresh full-suite run. The five aliases D28-025–D28-029 remain mapped to D28-006, D28-007 or D28-008 rather than being counted as additional independent repairs. The historical register metadata validates; this is metadata consistency, not native execution proof.

Notable included fixes are the comments-sheet loading/error overflow containment, border-aware compact chat attachment sizing, compact/enlarged-text People rows, scrollable short-height dialogs/auth guards, wrapping privacy pills and post action counts, intrinsic unread-badge sizing, exact accessible unread counts, full live-title disclosure, truthful media error labels and per-card onboarding join progress.

### Preservation after the repair batches

Only two owned UI paths changed after the final design repair commit:

- `app/onboarding.tsx`: the People feature adds a current-account-fenced interest-save success invalidation. The membership target and per-card progress repair remains present; its dedicated test passes.
- `components/circles-ui.tsx`: the newest commit extracts the duplicated Avatar fallback markup without changing its dimensions, colors, initials, text sizing or surrounding live-ring behavior. Other repaired primitive behavior remains present; the related dedicated test passes.

The other owned implementation and dedicated-test paths are byte-identical to the final design repair source. The delta-scoped independent review found no newly confirmed behavioral source regression in the latest consolidation commit.

See the complete 24-row design inclusion table (task-local evidence; not included in the repository), its source-blob evidence (task-local evidence; not included in the repository), and the latest commit review (task-local evidence; not included in the repository).

**Physical Android/iOS, keyboard/IME, large-native-font, safe-area and screen-reader verification remain unexecuted.** Source preservation and passing mock/source tests do not close those historical gaps. This check did not perform a new all-screen visual audit.

## 3. Latest commit review

`c7ad369` changes 11 paths. It consolidates Avatar fallback markup, shared Activity/Moderation display-state and numeric-ID helpers, onboarding profile projections and supervisor readiness classification, and removes obsolete commented router scaffolding.

The review confirmed preservation of the inspected public interfaces, account/circle authority gates, retained-query presentation, count visibility, onboarding lock/finish behavior, Avatar/live overlay sizing, and the distinction between API liveness and dependency readiness. It reported one inherited CI portability blocker, not a new runtime regression introduced by the refactor.

## 4. Live runtime is blocked by database authentication

Fresh probes against both loopback and the current configured public preview observed:

| Probe | Result |
|---|---|
| `/api/health` | **200** — process is alive |
| `/api/ready` | **503** — application data readiness fails |
| `social.profilesPage` | **INTERNAL_SERVER_ERROR** |
| Fresh PostgreSQL connection after trusted runtime refresh | **28P01 — configured password rejected** |

The running API's database setting equals the refreshed setting. This rules out fixing the rejection merely by restarting with the same credential. The watchdog is still supervising generation 1; it deliberately does not churn a healthy process on dependency-readiness failure. A secondary observation is that the running email opt-in differs from the refreshed setting; that does not account for the independently reproduced password rejection and was not changed during this check.

**Required next action:** repair the existing configured Supabase database credential through protected secret input, then perform controlled runtime refresh and repeat readiness plus People queries. Do not rotate unrelated session/media keys, install schema changes, switch database roles, or create production fixtures to make this check pass. No credential replacement or service restart was performed here.

See fresh credential-safe database evidence (task-local evidence; not included in the repository) and live probe results (task-local evidence; not included in the repository).

## 5. GitHub CI is blocked, despite local success

| Version | App CI | Container validation |
|---|---|---|
| `20652cb` | **Failed:** 1,147/1,148 tests passed | **Passed** |
| `c7ad369` | **Failed:** 1,162/1,163 tests passed | **Passed** |

The same test fails in both runs:

```text
tests/dev-supervisor.test.ts:198
recovers a synthetic owned crash with a new generation and restored health
EACCES: permission denied, mkdir '/home/ubuntu'
```

The crash/recovery assertions succeed locally because that directory is writable in this sandbox. The test's evidence-writing path is machine-specific, so a green local suite cannot be substituted for remote CI success.

**Recommended correction, not applied:** store the crash-test evidence under its existing disposable `mkdtemp` directory, or a repository-owned test-artifact directory, retaining private permissions, cleanup and the same recovery assertions. Then commit the narrow test correction and await the resulting exact-source CI run.

The failed unit step caused remote recommendation PostgreSQL E2E, other later integration steps and platform JS bundle jobs to be skipped. Their remote success is not claimed. Fresh local recommendation E2E was run separately as described above.

- [Latest failed app CI](https://github.com/mattwms76/Circles/actions/runs/40886857064)
- [Latest passed API container validation](https://github.com/mattwms76/Circles/actions/runs/40886857366)
- [Previously pushed failed app CI](https://github.com/mattwms76/Circles/actions/runs/40848383843)
- [Previously pushed passed API container validation](https://github.com/mattwms76/Circles/actions/runs/40848383803)

Container validation does not certify the current private database credential or live recommendation response.

## Scope and cleanup

The latest GitHub source was tested in a detached, exact-source worktree. Its temporary dependency symlink was removed after testing; the disposable database fixture was removed, and both tracked source trees are unchanged. The running preview remains on `20652cb`; this review did not synchronize it to `c7ad369`, restart its services, replace credentials, change providers/DDL, publish, push, or mutate production data.
