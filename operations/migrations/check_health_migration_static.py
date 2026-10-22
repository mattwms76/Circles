#!/usr/bin/env python3
"""Static-only contract checks for the Circles operations health migration.

This program reads SQL text only. It never opens a database connection and never executes SQL.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SQL_PATH = ROOT / "0001_circles_ops_daily_migration_health.sql"
EXPECTED_SOURCE_TREE = "manifest-sha256:1196b25e66280952d905d860e3488fa82af9d082983c5315f28ead30b35172a7"
EXPECTED_TABLES = (
    "users", "profiles", "circles", "memberships", "posts", "reactions", "bookmarks",
    "comments", "conversations", "conversationParticipants", "messages", "follows", "reports",
    "socialUploads", "socialSeedMarkers", "_dataMigrations", "applicationSessions", "streams",
    "activeHostLeases", "liveViewers", "liveSignals", "liveChat",
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    sql = SQL_PATH.read_text(encoding="utf-8")

    require(sql.count("CREATE SCHEMA circles_ops AUTHORIZATION postgres;") == 1, "must create exactly one circles_ops schema")
    require("CREATE TABLE circles_ops.health_runs" in sql, "must create the bounded health history table")
    require("ALTER TABLE circles_ops.health_runs ENABLE ROW LEVEL SECURITY;" in sql, "health history must enable RLS")
    require("TO postgres\n  USING (true)\n  WITH CHECK (true);" in sql, "health history requires postgres-only policy")
    require("SECURITY DEFINER\nSET search_path = pg_catalog" in sql, "function must be SECURITY DEFINER with fixed pg_catalog search_path")
    require("CREATE FUNCTION circles_ops.run_daily_migration_health()" in sql, "missing fixed no-argument health function")
    require("REVOKE ALL ON FUNCTION circles_ops.run_daily_migration_health() FROM PUBLIC, anon, authenticated, service_role, circles_app_runtime;" in sql, "function must be revoked from non-admin roles")
    require("GRANT EXECUTE ON FUNCTION circles_ops.run_daily_migration_health() TO postgres;" in sql, "only postgres may execute the function")
    require(EXPECTED_SOURCE_TREE in sql, "approved manifest sourceTree fingerprint changed or missing")
    require("'circles-mysql-to-supabase-v1'" in sql, "approved migration marker key missing")
    require("LIMIT 1" in sql, "marker existence test must be bounded")
    require("pg_catalog.make_interval(days => 90)" in sql, "history retention must remain 90 days")
    require("DELETE FROM circles_ops.health_runs" in sql, "retention may delete only ops history")
    require("INSERT INTO circles_app" not in sql and "UPDATE circles_app" not in sql and "DELETE FROM circles_app" not in sql, "migration must not write app data")
    require(not re.search(r"(?im)^\s*EXECUTE\s+", sql), "dynamic EXECUTE is prohibited")
    require(not re.search(r"(?i)\bcron\.schedule\b|\bdblink\b|\bhttp_", sql), "migration must not schedule jobs or call external services")
    require(not re.search(r"(?i)\bcreate\s+role\b|\balter\s+role\b|\bpassword\b", sql), "migration must not change role credentials or role attributes")
    require("'drift_detected'" in sql and "'health_check_exception'" in sql, "failures must be stored with sanitized fixed codes")
    require("GET STACKED DIAGNOSTICS" not in sql and "SQLERRM" not in sql, "raw SQL errors must not be stored or returned")
    require("observed_app_table_count" in sql and "row_count" not in sql.lower(), "must audit catalog shape, not frozen application row counts")

    for table_name in EXPECTED_TABLES:
        require(f"'{table_name}'::pg_catalog.name" in sql, f"expected app table missing from static contract: {table_name}")
    require(len(EXPECTED_TABLES) == 22, "test fixture must retain the current 22-table contract")

    print("PASS: static operations-health migration contract")
    print("PASS: 22 fixed app table names and approved marker fingerprint present")
    print("PASS: no database connection, SQL execution, scheduler call, or app-data write performed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, OSError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
