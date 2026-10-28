# Pending-scope Preview crash: source hardening

On 28 October 2026 the running Metro web bundle was inspected after both `/circles` and public Circle details displayed `isPendingAccountResourceScope is not a function`. The checked source at local commit `dc56e5f8961a0990c2e5a018f4ae882bda4c0957`, tree `d52793f9adac74bb79938001eaee123a4e06caea`, correctly exported that function. The served helper module contained its older exports but neither the pending comparator definition nor its export. Metro's working directory was the active app and CI mode was false. This establishes a source-to-served-bundle mismatch, not the exact internal cache/file-map cause.

`metro.config.js` now preserves Expo's existing cache version and appends a SHA-256 digest of `lib/batch3-account-resource-scope.ts`. The installed Metro transform key consumes `cacheVersion`. A newly started Metro process therefore uses a different transform namespace when this helper changes. Existing NativeWind disk stylesheet preparation, `forceWriteFileSystem`, and API proxy middleware remain intact. The helper, CircleCard, Circle details, actor/generation fences, dependencies, native IDs and SQL are unchanged.

This is startup-time hardening, not an automatic repair of an already-stale process. Runtime closure still requires an authorized Metro-only restart with its trusted environment, retained heap settings, unchanged port8081 and `--clear`, while preserving the healthy API on3000. Then inspect the actual served helper module and the settled directory/details routes. Plain source tests or a GitHub push do not prove that runtime repair.

## Verification

The exact prepared code passed 33 focused tests in five files: cache configuration5, pending/control8, operation lifecycle4, Circle repairs13 and NativeWind cache3. The new tests execute the actual config using explicitly mocked Expo, filesystem, NativeWind and proxy adapters; they verify the digest namespace, change sensitivity, deterministic keys, disk-backed CSS setup and proxy ordering. They do not start Metro or use native devices.

Strict TypeScript with unused-code checks, scoped ESLint and formatting passed. An initial test-only unused-parameter diagnostic was corrected and the five cache tests rerun successfully; those reruns are not added to the33-test total. The prepared patch applied cleanly to the exact source base. Remote workflow completion is a separate receipt, not implied by these local checks.

The owner subsequently authorized committing and pushing the validated source. Private bundle captures, audit screenshots, connection configuration and external evidence archives are excluded from Git. No service restart, database/provider/role change, account operation, deployment or publication is part of this source save. The known separate Manus-managed Git transport blocker remains distinct from the authorized GitHub mirror; no Manus checkpoint is claimed.
