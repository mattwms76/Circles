#!/usr/bin/env node
/**
 * Pure, synthetic SEC27 health/watchdog evaluator.
 *
 * This module is intentionally incapable of querying a scheduler/database or
 * sending an alert. Its delivery record is an explicit local mock, not a provider
 * request or a watchdog implementation.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRESHNESS = new Set(["fresh", "stale", "unavailable"]);

function assertInput({
  freshness,
  aggregateHealthy,
  lagMinutes,
  incidentOpen,
}) {
  if (!FRESHNESS.has(freshness))
    throw new TypeError("synthetic_freshness_invalid");
  if (typeof aggregateHealthy !== "boolean") {
    throw new TypeError("synthetic_aggregate_health_invalid");
  }
  if (!Number.isSafeInteger(lagMinutes) || lagMinutes < 0) {
    throw new TypeError("synthetic_lag_invalid");
  }
  if (typeof incidentOpen !== "boolean") {
    throw new TypeError("synthetic_incident_state_invalid");
  }
}

/**
 * Deterministically evaluates one sanitized synthetic aggregate. No clocks,
 * I/O, scheduler changes, alert transport, or persistent state are used.
 */
export function evaluateSyntheticFreshnessWatchdog(input) {
  assertInput(input);
  const conditionOpen = input.freshness !== "fresh" || !input.aggregateHealthy;
  const nextIncidentOpen = conditionOpen;
  const transition = conditionOpen
    ? input.incidentOpen
      ? "condition_remains_open"
      : "condition_open"
    : input.incidentOpen
      ? "condition_recovered"
      : "condition_clear";

  return Object.freeze({
    conditionOpen,
    nextIncidentOpen,
    transition,
    lagMinutes: input.lagMinutes,
    delivery: Object.freeze({
      mocked: true,
      externalAttempted: false,
      externalDelivered: false,
    }),
  });
}

/**
 * Exercises stale and unhealthy opens plus a fresh recovery. The returned proof
 * contains only booleans, counts, a synthetic lag, and no provider data.
 */
export function runSyntheticFreshnessWatchdogDrill() {
  const stale = evaluateSyntheticFreshnessWatchdog({
    freshness: "stale",
    aggregateHealthy: true,
    lagMinutes: 61,
    incidentOpen: false,
  });
  const unhealthy = evaluateSyntheticFreshnessWatchdog({
    freshness: "fresh",
    aggregateHealthy: false,
    lagMinutes: 1,
    incidentOpen: false,
  });
  const recovery = evaluateSyntheticFreshnessWatchdog({
    freshness: "fresh",
    aggregateHealthy: true,
    lagMinutes: 1,
    incidentOpen: stale.nextIncidentOpen,
  });

  return Object.freeze({
    synthetic_only: true,
    stale_condition_open: stale.transition === "condition_open",
    unhealthy_condition_open: unhealthy.transition === "condition_open",
    fresh_recovery_confirmed: recovery.transition === "condition_recovered",
    mocked_delivery_records: 3,
    external_delivery_attempts: 0,
    scheduler_queries: 0,
    database_queries: 0,
    new_schedules: 0,
    new_watchdogs: 0,
    maximum_synthetic_lag_minutes: Math.max(
      stale.lagMinutes,
      unhealthy.lagMinutes,
      recovery.lagMinutes,
    ),
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.stdout.write(
    `${JSON.stringify(runSyntheticFreshnessWatchdogDrill())}\n`,
  );
}
