# SEC27 health freshness and alert evidence preparation

This is a source-only preparation for SEC-026. It does not query `circles_ops.health_runs`, inspect Cron run history, read application rows, send an alert, create an issue, modify a workflow, or configure an external destination. It preserves the already documented boundary: one active daily health Cron job (job 7 at 03:15 UTC) and one existing private watchdog. No duplicate Cron, watchdog, schedule, retention change, or recovery process is authorized here.

Use `sec27-health-evidence-template.json` only as a value-free evidence shape. It deliberately permits outcome categories and state transitions, not timestamps, SQL output, error text, connection material, issue bodies, destinations, application rows, health check payloads, or credentials.

A future owner-approved, read-only observation must collect only a sanitized aggregate that establishes whether the existing health result is fresh, stale, or unavailable and whether its aggregate health state is healthy or unhealthy. It must separately record whether the existing private watchdog opened its own incident on a synthetic condition and closed that same incident after recovery. Receipt from an external notification channel remains unverified unless that channel independently provides a safe owner-visible receipt.

The required non-live drill has three synthetic inputs: a stale result, an unhealthy result, and a fresh recovery result. The evaluator must map the first two to the existing watchdog's condition-open behavior and the third to its recovery behavior without calling a scheduler, database, provider, or external alert endpoint. It must retain only the template categories and cleanup result. A local simulated drill cannot prove that the existing Cron executed or that an external notification was delivered.

The remaining gates are an owner-approved metadata-only freshness observation, a controlled verification of the existing watchdog's stale/unhealthy and recovery transitions, and any separately authorized notification-receipt evidence. None is closed by this document or its synthetic template.
