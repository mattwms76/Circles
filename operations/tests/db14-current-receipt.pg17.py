#!/usr/bin/env python3
"""Disposable local PostgreSQL 17 proof for DB-14 current receipt reconciliation.

Run from the repository root without a DSN, .env, provider, network, or application service:
  env -i PATH=/usr/bin:/bin HOME=/tmp CI=1 /usr/bin/python3 -B \
    operations/tests/db14-current-receipt.pg17.py --local-pg17

The fixture first creates the historical five-column receipt state from reviewed source migrations,
then synthesizes only the captured schema metadata for the approved six-column receipt state. It
never creates user rows or connects outside loopback.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
from typing import Callable, NoReturn

import psycopg
from psycopg.rows import dict_row

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PG_BIN = Path("/usr/lib/postgresql/17/bin")
RECONCILIATION_SQL = "operations/remediation/db14_current_receipt_contract.sql"
DAILY_WRAPPER_SQL = "operations/remediation/db14_current_receipt_daily_wrapper.sql"
DATABASE_NAME = "db14_current_receipt_" + secrets.token_hex(12)

_fixture_spec = importlib.util.spec_from_file_location(
    "db14_critical_fixture",
    PROJECT_ROOT / "operations/tests/db14-critical-contracts.pg17.py",
)
if _fixture_spec is None or _fixture_spec.loader is None:
    raise RuntimeError("unable to import the source-owned DB-14 fixture bootstrap")
_fixture = importlib.util.module_from_spec(_fixture_spec)
_fixture_spec.loader.exec_module(_fixture)

_daily_fixture_spec = importlib.util.spec_from_file_location(
    "db14_daily_health_fixture",
    PROJECT_ROOT / "operations/tests/db14-daily-health-extension.pg17.py",
)
if _daily_fixture_spec is None or _daily_fixture_spec.loader is None:
    raise RuntimeError("unable to import the source-owned daily health fixture bootstrap")
_daily_fixture = importlib.util.module_from_spec(_daily_fixture_spec)
_daily_fixture_spec.loader.exec_module(_daily_fixture)


def fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def local_environment(home: Path) -> dict[str, str]:
    """Explicitly deny inherited DSNs, credentials, proxies, and configuration."""
    return {
        "PATH": f"{PG_BIN}:/usr/bin:/bin",
        "HOME": str(home),
        "CI": "1",
    }


def checked(argv: list[str], environment: dict[str, str], timeout: int = 90) -> None:
    result = subprocess.run(
        argv,
        cwd=PROJECT_ROOT,
        env=environment,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        fail("disposable PostgreSQL command failed")


def reserve_loopback_port() -> int:
    for _ in range(32):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = int(reservation.getsockname()[1])
        if port not in (3000, 8081):
            return port
    fail("unable to reserve a loopback fixture port")


def source_template(name: str) -> str:
    source = (PROJECT_ROOT / "server/_core/database-contracts.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(rf"export const {re.escape(name)} = `([\s\S]*?)`;", source)
    if match is None:
        fail(f"unable to locate {name}")
    return match.group(1)


def scalar_bool(connection: psycopg.Connection[dict[str, object]], statement: str) -> bool:
    row = connection.execute(statement).fetchone()
    if row is None or len(row) != 1:
        fail("catalog readiness probe returned no boolean")
    return next(iter(row.values())) is True


def assert_runtime_receipt(
    connection: psycopg.Connection[dict[str, object]], expected: bool
) -> None:
    connection.execute("SET ROLE circles_app_runtime")
    try:
        observed = scalar_bool(connection, source_template("POST_PUBLICATION_STATUS_SQL"))
    finally:
        connection.execute("RESET ROLE")
    if observed is not expected:
        fail("runtime receipt readiness did not fail closed as expected")


def assert_critical(
    connection: psycopg.Connection[dict[str, object]], expected: bool
) -> None:
    row = connection.execute(
        "SELECT healthy, error_code FROM circles_ops.run_daily_critical_feature_health()"
    ).fetchone()
    if row is None or row.get("healthy") is not expected:
        fail("critical daily helper did not report the expected receipt state")
    if expected and row.get("error_code") is not None:
        fail("healthy critical helper exposed a non-null error code")
    if not expected and row.get("error_code") != "critical_feature_catalog_drift":
        fail("critical receipt drift did not use the sanitized drift result")


def expect_error(operation: Callable[[], object], fragment: str) -> None:
    try:
        operation()
    except psycopg.Error as error:
        if fragment not in str(error):
            fail(f"expected refusal fragment {fragment!r}, got {str(error)[:240]!r}")
    else:
        fail("expected guarded local SQL refusal")


def helper_metadata(connection: psycopg.Connection[dict[str, object]]) -> dict[str, object]:
    row = connection.execute(
        """
        SELECT f.oid, o.rolname AS owner, f.prosecdef AS security_definer,
               f.proconfig AS config, f.proacl::text AS acl,
               pg_catalog.md5(pg_catalog.pg_get_functiondef(f.oid)) AS definition_md5
        FROM pg_catalog.pg_proc AS f
        JOIN pg_catalog.pg_namespace AS n ON n.oid = f.pronamespace
        JOIN pg_catalog.pg_roles AS o ON o.oid = f.proowner
        WHERE n.nspname = 'circles_ops'
          AND f.proname = 'run_daily_critical_feature_health'
          AND f.pronargs = 0
        """
    ).fetchone()
    if row is None:
        fail("critical helper metadata was unavailable")
    return row


def daily_metadata(connection: psycopg.Connection[dict[str, object]]) -> dict[str, object]:
    row = connection.execute(
        """
        SELECT f.oid, o.rolname AS owner, f.prosecdef AS security_definer,
               f.proconfig AS config, f.proacl::text AS acl,
               pg_catalog.md5(pg_catalog.pg_get_functiondef(f.oid)) AS definition_md5,
               pg_catalog.md5(f.prosrc) AS body_md5
        FROM pg_catalog.pg_proc AS f
        JOIN pg_catalog.pg_namespace AS n ON n.oid = f.pronamespace
        JOIN pg_catalog.pg_roles AS o ON o.oid = f.proowner
        WHERE n.nspname = 'circles_ops'
          AND f.proname = 'run_daily_migration_health'
          AND f.pronargs = 0
        """
    ).fetchone()
    if row is None:
        fail("daily wrapper metadata was unavailable")
    return row


def assert_current_receipt_catalog(connection: psycopg.Connection[dict[str, object]]) -> None:
    columns = connection.execute(
        """
        SELECT a.attname AS name, a.attnum AS ordinal,
               pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
               a.attnotnull AS not_null, a.attidentity AS identity
        FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = 'circles_publish."postPublishReceipts"'::pg_catalog.regclass
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
        """
    ).fetchall()
    expected = [
        {"name": "actorId", "ordinal": 1, "data_type": "integer", "not_null": True, "identity": ""},
        {"name": "operationId", "ordinal": 2, "data_type": "character varying(96)", "not_null": True, "identity": ""},
        {"name": "payloadHash", "ordinal": 3, "data_type": "character varying(64)", "not_null": True, "identity": ""},
        {"name": "postId", "ordinal": 4, "data_type": "integer", "not_null": False, "identity": ""},
        {"name": "createdAt", "ordinal": 5, "data_type": "timestamp with time zone", "not_null": True, "identity": ""},
        {"name": "id", "ordinal": 6, "data_type": "bigint", "not_null": True, "identity": "a"},
    ]
    if columns != expected:
        fail("synthetic current receipt metadata differs from captured six-column state")
    keys = connection.execute(
        """
        SELECT c.conname AS name, c.contype AS kind, c.conkey::text AS key_columns
        FROM pg_catalog.pg_constraint AS c
        WHERE c.conrelid = 'circles_publish."postPublishReceipts"'::pg_catalog.regclass
          AND c.conname IN ('post_publish_receipts_pkey', 'post_publish_receipts_actor_operation_unique')
        ORDER BY c.conname
        """
    ).fetchall()
    if keys != [
        {"name": "post_publish_receipts_actor_operation_unique", "kind": "u", "key_columns": "{1,2}"},
        {"name": "post_publish_receipts_pkey", "kind": "p", "key_columns": "{6}"},
    ]:
        fail("synthetic current receipt key inventory differs from captured state")


def establish_current_receipt_state(connection: psycopg.Connection[dict[str, object]]) -> None:
    connection.execute(
        """
        ALTER TABLE circles_publish."postPublishReceipts"
          ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY (
            SEQUENCE NAME circles_publish."postPublishReceipts_id_seq"
          );
        ALTER TABLE circles_publish."postPublishReceipts"
          ADD CONSTRAINT post_publish_receipts_pkey PRIMARY KEY (id);
        """
    )
    assert_current_receipt_catalog(connection)


def latest_sanitized_daily_detail(
    connection: psycopg.Connection[dict[str, object]],
) -> dict[str, object]:
    row = connection.execute(
        """
        SELECT checks
        FROM circles_ops.health_runs
        ORDER BY run_id DESC
        LIMIT 1
        """
    ).fetchone()
    checks = row.get("checks") if row is not None else None
    if not isinstance(checks, dict):
        return {"failed_checks": ["latest_health_check_unavailable"]}
    return {
        "failed_checks": sorted(
            key for key, value in checks.items() if value is False
        )
    }


def assert_daily_history(
    connection: psycopg.Connection[dict[str, object]], expected: bool
) -> None:
    row = connection.execute(
        "SELECT healthy, error_code FROM circles_ops.run_daily_migration_health()"
    ).fetchone()
    expected_error = None if expected else "drift_detected"
    if (
        row is None
        or row.get("healthy") is not expected
        or row.get("error_code") != expected_error
    ):
        fail(
            "daily migration helper did not retain the expected receipt integration: "
            + json.dumps(
                {
                    "result": row,
                    "latest_sanitized_detail": latest_sanitized_daily_detail(connection),
                },
                sort_keys=True,
                default=str,
            )
        )


def probe_drift(
    connection: psycopg.Connection[dict[str, object]], label: str, statement: str
) -> None:
    connection.execute("BEGIN")
    try:
        connection.execute(statement)
        assert_runtime_receipt(connection, False)
        assert_critical(connection, False)
        assert_daily_history(connection, False)
    finally:
        connection.execute("ROLLBACK")
    print(f"PASS: {label}", flush=True)


def main() -> int:
    if sys.argv[1:] != ["--local-pg17"]:
        print("SKIP: pass --local-pg17 for the disposable loopback PostgreSQL 17 drill")
        return 0

    evidence: dict[str, object] = {
        "fixture": "fresh-local-postgresql-17-loopback-only",
        "production_access": False,
        "production_write": False,
        "provider_access": False,
        "passed": False,
    }
    phase = "preflight"
    temporary: Path | None = None
    connection: psycopg.Connection[dict[str, object]] | None = None
    started = False
    try:
        if not (PG_BIN / "initdb").is_file() or not (PG_BIN / "pg_ctl").is_file():
            fail("PostgreSQL 17 binaries are unavailable")
        reconciliation = (PROJECT_ROOT / RECONCILIATION_SQL).read_text(encoding="utf-8")
        if "CREATE OR REPLACE FUNCTION circles_ops.run_daily_critical_feature_health()" not in reconciliation:
            fail("current reconciliation must retain the proven helper object identity")
        if "b264e91a24358686129a2b2386b9dcdf" not in reconciliation:
            fail("current reconciliation does not pin the captured old helper definition")
        if "cron.schedule" in reconciliation or "DELETE FROM circles_app" in reconciliation:
            fail("receipt reconciliation must not change schedules or application rows")
        daily_wrapper = (PROJECT_ROOT / DAILY_WRAPPER_SQL).read_text(encoding="utf-8")
        if "CREATE OR REPLACE FUNCTION circles_ops.run_daily_migration_health" in daily_wrapper:
            fail("daily-wrapper compatibility must not carry a hand-copied daily definition")
        if any(token in daily_wrapper.lower() for token in ("cron.", "pg_cron", "schedule(", "health_runs")):
            fail("daily-wrapper compatibility must not alter scheduling or history")
        if ">=" in daily_wrapper:
            fail("daily-wrapper compatibility must not use broad receipt column thresholds")
        if "8a2551dee9f2ea3216d61f82fef70fa1" not in daily_wrapper:
            fail("daily-wrapper compatibility does not pin the prior daily definition")
        if "ba01f17b09fd2a4464edaf10b55d4389" not in daily_wrapper:
            fail("daily-wrapper compatibility does not require the reconciled helper")

        temporary = Path(tempfile.mkdtemp(prefix="circles-db14-current-receipt-pg17-"))
        temporary.chmod(0o700)
        environment = local_environment(temporary)
        port = reserve_loopback_port()
        phase = "initdb"
        checked([
            str(PG_BIN / "initdb"), "-D", str(temporary / "data"), "-A", "trust",
            "-U", "postgres", "--no-locale", "-E", "UTF8",
        ], environment)
        phase = "start-loopback-postgres"
        checked([
            str(PG_BIN / "pg_ctl"), "-D", str(temporary / "data"), "-l",
            str(temporary / "postgres.log"), "-o", f"-h 127.0.0.1 -p {port} -k {temporary}",
            "-w", "start",
        ], environment)
        started = True
        with psycopg.connect(
            host="127.0.0.1", port=port, dbname="postgres", user="postgres",
            connect_timeout=5, autocommit=True,
        ) as bootstrap:
            bootstrap.execute(
                "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; "
                "CREATE ROLE service_role NOLOGIN"
            )

        phase = "apply-reviewed-legacy-baseline"
        variants = _daily_fixture.canonical_app_policy_variants()
        _daily_fixture.assert_current_contract_matches_captured_catalog(variants)
        connection = _daily_fixture.bootstrap_database(port, DATABASE_NAME, variants)
        _daily_fixture.apply(connection, _daily_fixture.EXTENSION)
        _daily_fixture.apply(connection, _daily_fixture.POLICY_NAME_PATCH)
        assert_runtime_receipt(connection, True)
        assert_critical(connection, True)
        assert_daily_history(connection, True)
        legacy_helper = helper_metadata(connection)
        if legacy_helper != {
            "oid": legacy_helper["oid"],
            "owner": "postgres",
            "security_definer": True,
            "config": ["search_path=pg_catalog"],
            "acl": "{postgres=X/postgres}",
            "definition_md5": "b264e91a24358686129a2b2386b9dcdf",
        }:
            fail(
                "legacy helper metadata does not match captured current baseline: "
                + json.dumps(legacy_helper, sort_keys=True, default=str)
            )
        legacy_daily = daily_metadata(connection)
        if legacy_daily != {
            "oid": legacy_daily["oid"],
            "owner": "postgres",
            "security_definer": True,
            "config": ["search_path=pg_catalog"],
            "acl": "{postgres=X/postgres}",
            "definition_md5": "8a2551dee9f2ea3216d61f82fef70fa1",
            "body_md5": "57fab8e62c7c01e34d393b78b972bd11",
        }:
            fail(
                "legacy daily wrapper metadata does not match the captured current baseline: "
                + json.dumps(legacy_daily, sort_keys=True, default=str)
            )
        print("PASS: exact five-column legacy baseline and daily wrapper remain healthy", flush=True)

        phase = "legacy-application-refusal"
        expect_error(
            lambda: connection.execute(reconciliation),
            "exact six-column surrogate receipt state",
        )
        connection.rollback()
        assert_critical(connection, True)
        print("PASS: legacy operational application is refused before any helper replacement", flush=True)

        phase = "synthesize-approved-current-state"
        establish_current_receipt_state(connection)
        phase = "old-helper-daily-wrapper-refusal"
        expect_error(
            lambda: connection.execute(daily_wrapper),
            "old or unreviewed critical helper baseline",
        )
        connection.rollback()
        if daily_metadata(connection) != legacy_daily:
            fail("old-helper wrapper refusal changed the preserved daily metadata")
        print("PASS: daily-wrapper compatibility refuses the old critical helper", flush=True)

        phase = "apply-current-reconciliation"
        connection.execute(reconciliation)
        current_helper = helper_metadata(connection)
        if current_helper["oid"] != legacy_helper["oid"]:
            fail("guarded helper reconciliation did not preserve the existing helper OID")
        if current_helper["owner"] != "postgres" or current_helper["security_definer"] is not True:
            fail("guarded helper reconciliation changed owner or SECURITY DEFINER")
        if current_helper["config"] != ["search_path=pg_catalog"] or current_helper["acl"] != "{postgres=X/postgres}":
            fail("guarded helper reconciliation changed the captured helper ACL/path")
        phase = "apply-current-daily-wrapper-compatibility"
        before_daily_wrapper = daily_metadata(connection)
        connection.execute(daily_wrapper)
        current_daily = daily_metadata(connection)
        if current_daily["oid"] != before_daily_wrapper["oid"]:
            fail("guarded daily-wrapper compatibility did not preserve the existing wrapper OID")
        for field in ("owner", "security_definer", "config", "acl"):
            if current_daily[field] != before_daily_wrapper[field]:
                fail(f"guarded daily-wrapper compatibility changed {field}")
        assert_runtime_receipt(connection, True)
        assert_critical(connection, True)
        assert_daily_history(connection, True)
        print("PASS: approved six-column surrogate receipt state is healthy through the daily wrapper", flush=True)

        phase = "legacy-variant-after-replacement"
        connection.execute("BEGIN")
        try:
            connection.execute('ALTER TABLE circles_publish."postPublishReceipts" DROP CONSTRAINT post_publish_receipts_pkey')
            connection.execute('ALTER TABLE circles_publish."postPublishReceipts" ALTER COLUMN id DROP IDENTITY')
            connection.execute('ALTER TABLE circles_publish."postPublishReceipts" DROP COLUMN id')
            assert_runtime_receipt(connection, True)
            assert_critical(connection, True)
            assert_daily_history(connection, True)
            connection.execute('ALTER TABLE circles_publish."postPublishReceipts" ADD COLUMN unexpected integer')
            assert_runtime_receipt(connection, False)
            assert_critical(connection, False)
            assert_daily_history(connection, False)
        finally:
            connection.execute("ROLLBACK")
        print("PASS: exact five-column legacy fixture is healthy and rejects arbitrary extras", flush=True)

        phase = "negative-receipt-drift"
        probe_drift(connection, "wrong column inventory", 'ALTER TABLE circles_publish."postPublishReceipts" ADD COLUMN unexpected integer')
        probe_drift(connection, "wrong column type", 'ALTER TABLE circles_publish."postPublishReceipts" ALTER COLUMN "payloadHash" TYPE text')
        probe_drift(connection, "wrong nullability", 'ALTER TABLE circles_publish."postPublishReceipts" ALTER COLUMN "createdAt" DROP NOT NULL')
        probe_drift(connection, "wrong identity", 'ALTER TABLE circles_publish."postPublishReceipts" ALTER COLUMN id DROP IDENTITY')
        probe_drift(connection, "missing surrogate primary key", 'ALTER TABLE circles_publish."postPublishReceipts" DROP CONSTRAINT post_publish_receipts_pkey')
        probe_drift(connection, "missing actor-operation unique", 'ALTER TABLE circles_publish."postPublishReceipts" DROP CONSTRAINT post_publish_receipts_actor_operation_unique')
        probe_drift(connection, "broadened runtime ACL", 'GRANT DELETE ON TABLE circles_publish."postPublishReceipts" TO circles_app_runtime')

        phase = "preapplied-daily-wrapper-refusal"
        expect_error(
            lambda: connection.execute(daily_wrapper),
            "golden definition or security metadata drifted",
        )
        connection.rollback()
        if daily_metadata(connection) != current_daily:
            fail("preapplied daily-wrapper refusal changed preserved wrapper metadata")
        assert_daily_history(connection, True)
        print("PASS: a prior daily-wrapper compatibility application is refused without mutation", flush=True)

        phase = "reapplication-refusal"
        expect_error(lambda: connection.execute(reconciliation), "unreviewed critical helper baseline")
        connection.rollback()
        if helper_metadata(connection)["oid"] != legacy_helper["oid"]:
            fail("refused reapplication changed the preserved helper OID")
        assert_runtime_receipt(connection, True)
        assert_critical(connection, True)
        assert_daily_history(connection, True)
        print("PASS: a prior reconciliation application is refused without mutation", flush=True)

        evidence.update({
            "passed": True,
            "postgres_major": 17,
            "legacy_variant": "five-column exact baseline",
            "current_variant": "six-column bigint GENERATED ALWAYS identity surrogate primary key",
            "negative_cases": ["column", "type", "nullability", "identity", "primary_key", "unique", "acl", "old_helper", "prior_application"],
            "helper_oid_preserved": True,
            "daily_wrapper_oid_preserved": True,
        })
    except Exception as error:
        evidence.update(
            {
                "failed_phase": phase,
                "error_category": type(error).__name__,
                "failure_reason": str(error)[:240],
            }
        )
    finally:
        if connection is not None:
            connection.close()
        if temporary is not None and started:
            try:
                checked([
                    str(PG_BIN / "pg_ctl"), "-D", str(temporary / "data"),
                    "-m", "immediate", "-w", "stop",
                ], local_environment(temporary))
            except Exception:
                evidence["passed"] = False
                evidence["cleanup_error"] = "local_postgresql_stop_failed"
        if temporary is not None:
            try:
                shutil.rmtree(temporary)
                evidence["disposable_fixture_removed"] = not temporary.exists()
            except Exception:
                evidence["passed"] = False
                evidence["cleanup_error"] = "local_fixture_removal_failed"
    print(json.dumps(evidence, sort_keys=True))
    return 0 if evidence["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
