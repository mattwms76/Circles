# Verification and evidence

## Classify findings and results

Separate runtime-reproduced failures, source-confirmed behavior, lint diagnostics, policy decisions, operating gaps and unexecuted paths. Deduplicate a shared outage rather than counting it once per screen. Do not treat a private group's discoverable teaser as an unauthorized content leak without a defined policy. Do not count all lint warnings as crashes.

Record a base commit/tree, environment-cleared test commands, exit codes and actual test counts. Distinguish current app evidence from a separate unapplied candidate. Never describe synthetic fixture identities as real Preview users.

## Patch and build integrity

Run TypeScript, the exact lint scope, complete tests and API compilation in a private source copy with no real .env/injected credentials. Keep startup/migrations separate. For Expo exports, use bounded workers and private dependency/cache files so the active Metro session is not disturbed. Web/native bundles are not signed APK/AAB/IPA or device validation.

Have one read-only reviewer trace changed parts and safety contracts; correct only confirmed integration problems and rerun affected paths. Avoid redundant full audit/acceptance rounds.

Serialize patches with Git color disabled. Produce a complete aggregate and, when useful, ordered scoped patches. Verify `git apply --check`, actual aggregate application and exact candidate-tree equality against the real intended base; test ordered-series equality separately. Include base/candidate identifiers, checksums and recovery instructions. Never force-push or erase repository history to distribute patches.

## Script tests and rollout limits

Use synthetic fixture servers and mock process managers/stores to test successful recovery, rejected preflight, ownership refusal, strict missing-context failure, no mutation execution, secret redaction, inventory drift and schema gates. Close finite server/DB/process resources in finally/cleanup. Do not claim that mocked restart tests restarted the user's service.

Preserve a structured endpoint report with positive reads, expected denial gates, incomplete cases and failures. Clear counters alone do not prove data correctness or native/provider operation.

## Delivery

Verify final files exist and are complete. Attach requested script and patch bundle with concise usage and explicit operational prerequisites. State whether app/source/schema/runtime changes were actually applied. Keep live and separate GitHub source consistent only when updates were requested; patch generation is not deployment authorization.

For a skill, remove unused initialization examples, keep SKILL.md concise, validate it with skill-creator quick_validate and attach `/home/ubuntu/skills/<name>/SKILL.md`. The attachment gives installation choices; do not claim the skill was installed automatically.
