#!/usr/bin/env python3
"""CBA-10 disposable PostgreSQL 17 regression drill.

Run only from the repository root with an explicit opt-in and no inherited settings:

  env -i PATH=/home/ubuntu/.nvm/versions/node/v22.23.4/bin:/usr/bin:/bin \
    HOME=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 CI=1 \
    CIRCLES_CBA10_LOCAL_PG17=1 /usr/bin/python3 -B \
    operations/tests/cba10-policy-health.pg17.py

The drill creates one temporary PostgreSQL 17 cluster bound only to 127.0.0.1. It accepts no
DSN or .env input, materializes only reviewed catalog metadata and policy fixtures, creates no
application/account fixture rows, and never contacts a provider or starts an application service.
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
from typing import Callable, NoReturn

import psycopg
from psycopg import sql
from psycopg.rows import dict_row


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PG_BIN = Path("/usr/lib/postgresql/17/bin")
MIGRATION = "operations/migrations/0023_circles_ops_policy_health.sql"
CURRENT_STATE = "current_pre_db09"
POST_CONSOLIDATION_STATE = "post_db09_12_group_consolidation"
EXPECTED_POLICY_COUNTS = {CURRENT_STATE: 96, POST_CONSOLIDATION_STATE: 86}

_fixture_spec = importlib.util.spec_from_file_location(
    "cba10_daily_fixture",
    PROJECT_ROOT / "operations/tests/db14-daily-health-extension.pg17.py",
)
if _fixture_spec is None or _fixture_spec.loader is None:
    raise RuntimeError("unable to import the source-owned daily-health fixture bootstrap")
_fixture = importlib.util.module_from_spec(_fixture_spec)
_fixture_spec.loader.exec_module(_fixture)

_receipt_fixture_spec = importlib.util.spec_from_file_location(
    "cba10_current_receipt_fixture",
    PROJECT_ROOT / "operations/tests/db14-current-receipt.pg17.py",
)
if _receipt_fixture_spec is None or _receipt_fixture_spec.loader is None:
    raise RuntimeError("unable to import the source-owned current receipt fixture")
_receipt_fixture = importlib.util.module_from_spec(_receipt_fixture_spec)
_receipt_fixture_spec.loader.exec_module(_receipt_fixture)


def fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def record(checks: list[str], message: str) -> None:
    checks.append(message)
    print(f"PASS: {message}", flush=True)


def checked(argv: list[str], environment: dict[str, str], *, timeout: int = 90) -> None:
    completed = subprocess.run(
        argv,
        cwd=PROJECT_ROOT,
        env=environment,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        fail("disposable PostgreSQL command failed")


def reserve_loopback_port() -> int:
    for _ in range(32):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = int(reservation.getsockname()[1])
        if port not in (3000, 8081):
            return port
    fail("unable to reserve a loopback fixture port")


def migration_sql() -> str:
    return (PROJECT_ROOT / MIGRATION).read_text(encoding="utf-8")


def apply(connection: psycopg.Connection[dict[str, object]]) -> None:
    connection.execute(migration_sql())


def expect_error(operation: Callable[[], object], fragment: str) -> None:
    try:
        operation()
    except psycopg.Error as error:
        if fragment not in str(error):
            fail(f"expected guarded refusal containing {fragment!r}, got {str(error)[:240]!r}")
    else:
        fail("expected guarded local SQL refusal")


def daily_metadata(connection: psycopg.Connection[dict[str, object]]) -> dict[str, object]:
    row = connection.execute(
        """
        SELECT
          function_catalog.oid::text AS oid,
          owner_catalog.rolname AS owner,
          function_catalog.prosecdef AS security_definer,
          function_catalog.proconfig AS config,
          function_catalog.proacl::text AS acl,
          pg_catalog.md5(pg_catalog.pg_get_functiondef(function_catalog.oid)) AS definition_md5,
          pg_catalog.md5(function_catalog.prosrc) AS body_md5
        FROM pg_catalog.pg_proc AS function_catalog
        JOIN pg_catalog.pg_namespace AS namespace_catalog
          ON namespace_catalog.oid = function_catalog.pronamespace
        JOIN pg_catalog.pg_roles AS owner_catalog
          ON owner_catalog.oid = function_catalog.proowner
        WHERE namespace_catalog.nspname = 'circles_ops'
          AND function_catalog.proname = 'run_daily_migration_health'
          AND function_catalog.pronargs = 0
        """
    ).fetchone()
    if row is None:
        fail("daily health metadata was unavailable")
    return row


def cron_sentinel(connection: psycopg.Connection[dict[str, object]]) -> dict[str, object]:
    row = connection.execute(
        "SELECT jobid, schedule, username::text AS username, active FROM cron.job WHERE jobid = 7"
    ).fetchone()
    if row is None:
        fail("synthetic Cron sentinel disappeared")
    return row


def assert_source_contract(sql_text: str) -> None:
    forbidden = (
        "cron.",
        "pg_cron",
        "schedule(",
        "unschedule(",
        "create policy",
        "alter policy",
        "drop policy",
        "create role",
        "alter role",
        "grant ",
        "revoke ",
        "delete from circles_app",
        "update circles_app",
        "insert into circles_app",
    )
    lowered = sql_text.lower()
    if any(token in lowered for token in forbidden):
        fail("CBA-10 migration contains an unauthorized scheduler, authorization, or app-row mutation")
    if sql_text.count("v_policy_anchor constant text") != 1:
        fail("CBA-10 must contain exactly one guarded stale-policy anchor")
    if sql_text.count("v_policy_replacement constant text") != 1:
        fail("CBA-10 must contain exactly one closed policy inventory replacement")
    if sql_text.count("pg_catalog.replace(v_daily_definition, v_policy_anchor, v_policy_replacement)") != 1:
        fail("CBA-10 must make exactly one guarded health-wrapper substitution")
    if "count(policy_catalog.oid) <> 1" not in sql_text:
        fail("CBA-10 must retain the obsolete predicate solely as the exact replacement anchor")
    if "EXCEPT ALL" not in sql_text or "policy_state_matches" not in sql_text:
        fail("CBA-10 must use bidirectional exact policy-set comparison")
    if "02c6415bd9f2715b4bae502b1ed934bb" not in sql_text:
        fail("CBA-10 must recognize the exact reviewed final current receipt wrapper")
    if "c9042815f6e02dcfbfe958a30eb7afae" not in sql_text:
        fail("CBA-10 must pin the final current receipt wrapper body")
    if "8a2551dee9f2ea3216d61f82fef70fa1" not in sql_text:
        fail("CBA-10 must retain the exact reviewed post-policy compatibility wrapper")

    replacement_match = re.search(
        r"v_policy_replacement constant text := \$cba10_policy_replacement\$\n(.*?)\n\$cba10_policy_replacement\$;",
        sql_text,
        re.DOTALL,
    )
    if replacement_match is None:
        fail("CBA-10 policy replacement literal is absent")
    rows = re.findall(
        r"\('(current_pre_db09|post_db09_12_group_consolidation)'::pg_catalog\.text,",
        replacement_match.group(1),
    )
    for state, expected_count in EXPECTED_POLICY_COUNTS.items():
        if rows.count(state) != expected_count:
            fail(f"CBA-10 {state} literal does not contain {expected_count} exact policy records")
    post_state = re.sub(
        r"\('current_pre_db09'::pg_catalog\.text,[\s\S]*?\('post_db09_12_group_consolidation'::pg_catalog\.text,",
        "('post_db09_12_group_consolidation'::pg_catalog.text,",
        replacement_match.group(1),
        count=1,
    )
    removed_by_db09 = (
        "circles_admin_parity_read_circles",
        "circles_admin_parity_read_comments",
        "circles_admin_parity_read_liveviewers",
        "circles_admin_parity_read_memberships",
        "circles_admin_parity_read_posts",
        "circles_admin_parity_read_profiles",
        "circles_admin_parity_read_reactions",
        "circles_admin_parity_read_reports",
        "circles_admin_parity_read_streams",
        "circles_admin_parity_read_users",
    )
    if any(policy_name in post_state for policy_name in removed_by_db09):
        fail("CBA-10 post-DB09 state retained a removed DB09 duplicate policy name")


def require_direct_execute_denial(
    connection: psycopg.Connection[dict[str, object]], role: str
) -> None:
    connection.execute(sql.SQL("SET ROLE {}").format(sql.Identifier(role)))
    try:
        expect_error(
            lambda: connection.execute("SELECT * FROM circles_ops.run_daily_migration_health()"),
            "permission denied",
        )
    finally:
        connection.execute("RESET ROLE")


def invoke_and_require(
    connection: psycopg.Connection[dict[str, object]], *, healthy: bool, policies: bool
) -> None:
    _fixture.invoke_and_require(connection, healthy=healthy, policies=policies)


def create_database(
    port: int,
    name: str,
    variants: dict[str, list[dict[str, object]]],
    *,
    policy_rows: list[dict[str, object]],
) -> psycopg.Connection[dict[str, object]]:
    return _fixture.bootstrap_database(
        port,
        name,
        variants,
        policy_rows=policy_rows,
        with_critical_helper=False,
    )


def main() -> int:
    if os.environ.get("CIRCLES_CBA10_LOCAL_PG17") != "1":
        print("SKIP: set CIRCLES_CBA10_LOCAL_PG17=1 for the disposable local PG17 drill")
        return 0

    evidence: dict[str, object] = {
        "fixture": "fresh-local-postgresql-17-loopback-only",
        "migration": MIGRATION,
        "production_access": False,
        "production_write": False,
        "provider_access": False,
        "application_account_rows_created": False,
        "passed": False,
    }
    checks: list[str] = []
    temporary: Path | None = None
    environment: dict[str, str] | None = None
    current: psycopg.Connection[dict[str, object]] | None = None
    post: psycopg.Connection[dict[str, object]] | None = None
    receipt: psycopg.Connection[dict[str, object]] | None = None
    drift: psycopg.Connection[dict[str, object]] | None = None
    started = False
    phase = "preflight"
    try:
        if not (PG_BIN / "initdb").is_file() or not (PG_BIN / "pg_ctl").is_file():
            fail("PostgreSQL 17 fixture binaries are unavailable")
        sql_text = migration_sql()
        assert_source_contract(sql_text)
        variants = _fixture.canonical_app_policy_variants()
        _fixture.assert_current_contract_matches_captured_catalog(variants)
    except Exception as error:
        evidence.update(
            {
                "failed_phase": phase,
                "error_category": type(error).__name__,
                "failure_reason": str(error)[:300],
            }
        )
        print(json.dumps(evidence, sort_keys=True))
        return 1

    try:
        phase = "init-local-pg17"
        temporary = Path(tempfile.mkdtemp(prefix="circles-cba10-policy-health-pg17-"))
        temporary.chmod(0o700)
        environment = _fixture._fixture.fixture_environment(temporary)
        port = reserve_loopback_port()
        checked(
            [
                str(PG_BIN / "initdb"),
                "-D",
                str(temporary / "data"),
                "-A",
                "trust",
                "-U",
                "postgres",
                "--no-locale",
                "-E",
                "UTF8",
            ],
            environment,
        )
        phase = "start-loopback-pg17"
        checked(
            [
                str(PG_BIN / "pg_ctl"),
                "-D",
                str(temporary / "data"),
                "-l",
                str(temporary / "postgres.log"),
                "-o",
                f"-h 127.0.0.1 -p {port} -k {temporary}",
                "-w",
                "start",
            ],
            environment,
        )
        started = True
        with psycopg.connect(
            host="127.0.0.1",
            port=port,
            dbname="postgres",
            user="postgres",
            connect_timeout=5,
            autocommit=True,
        ) as control:
            control.execute(
                "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; "
                "CREATE ROLE service_role NOLOGIN; "
                "CREATE ROLE cba10_unreviewed LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS"
            )

        # Derive the 86-row state directly from DB09's reviewed expected-pairs CTE on this
        # synthetic catalog; no hand-maintained duplicate list is accepted.
        phase = "derive-reviewed-policy-fixtures"
        derivation = create_database(
            port,
            "cba10_derive_" + secrets.token_hex(8),
            variants,
            policy_rows=variants[CURRENT_STATE],
        )
        try:
            # The source-owned selector evaluates DB09's reviewed expected-pairs CTE against
            # a catalog-only synthetic database; it does not read or create app/account rows.
            post_rows = _fixture.derive_post_consolidation_policy_rows(
                derivation,
                variants,
            )
        finally:
            derivation.close()
        if len(post_rows) != EXPECTED_POLICY_COUNTS[POST_CONSOLIDATION_STATE]:
            fail("DB09-derived fixture does not contain the reviewed 86-policy state")
        record(
            checks,
            "static migration contract excludes scheduler/grant/policy/app-row changes and pins both closed policy inventories",
        )

        phase = "current-96-policy-state"
        current = create_database(
            port,
            "cba10_current_" + secrets.token_hex(8),
            variants,
            policy_rows=variants[CURRENT_STATE],
        )
        if _fixture.observed_app_policies(current) != _fixture.expected_policy_rows(
            variants[CURRENT_STATE]
        ):
            fail("synthetic current fixture is not the reviewed 96-policy state")
        before = daily_metadata(current)
        before_cron = cron_sentinel(current)
        invoke_and_require(current, healthy=False, policies=False)
        apply(current)
        after = daily_metadata(current)
        if after["oid"] != before["oid"]:
            fail("CBA-10 changed the daily health function OID")
        for field in ("owner", "security_definer", "config", "acl"):
            if after[field] != before[field]:
                fail(f"CBA-10 changed daily health {field}")
        if after["definition_md5"] == before["definition_md5"]:
            fail("CBA-10 did not replace the stale policy predicate")
        if cron_sentinel(current) != before_cron:
            fail("CBA-10 changed the synthetic Cron sentinel")
        invoke_and_require(current, healthy=True, policies=True)
        require_direct_execute_denial(current, "circles_app_runtime")
        require_direct_execute_denial(current, "anon")
        require_direct_execute_denial(current, "authenticated")
        record(
            checks,
            "complete reviewed 96-policy multi-policy state changes from false drift to healthy while OID, security metadata, direct-execute denial, history, and Cron sentinel remain preserved",
        )

        phase = "actual-policy-drift"
        current.execute(
            "CREATE POLICY cba10_extra_messages_policy ON circles_app.messages "
            "FOR SELECT TO cba10_unreviewed USING (false)"
        )
        invoke_and_require(current, healthy=False, policies=False)
        current.execute("DROP POLICY cba10_extra_messages_policy ON circles_app.messages")
        invoke_and_require(current, healthy=True, policies=True)
        current.execute(
            "ALTER POLICY runtime_messages_policy ON circles_app.messages "
            "USING (false) WITH CHECK (false)"
        )
        invoke_and_require(current, healthy=False, policies=False)
        current.execute(
            "ALTER POLICY runtime_messages_policy ON circles_app.messages "
            "USING (true) WITH CHECK (true)"
        )
        invoke_and_require(current, healthy=True, policies=True)
        current.execute("DROP POLICY circles_admin_read_circles ON circles_app.circles")
        invoke_and_require(current, healthy=False, policies=False)
        _fixture.install_exact_policy_state(current, variants[CURRENT_STATE])
        invoke_and_require(current, healthy=True, policies=True)
        record(
            checks,
            "extra, changed, and removed policy records each fail the actual closed catalog comparison and healthy exact recovery remains possible",
        )

        phase = "source-baseline-reapplication-refusal"
        stable_after = daily_metadata(current)
        expect_error(lambda: apply(current), "exact reviewed source, post-policy, or current receipt")
        current.rollback()
        if daily_metadata(current) != stable_after:
            fail("refused CBA-10 reapplication changed the health wrapper")
        record(checks, "a second CBA-10 application refuses its non-baseline post-state without mutation")

        phase = "post-db09-86-policy-state"
        post = create_database(
            port,
            "cba10_post_db09_" + secrets.token_hex(8),
            variants,
            policy_rows=post_rows,
        )
        if _fixture.observed_app_policies(post) != _fixture.expected_policy_rows(post_rows):
            fail("synthetic post-DB09 fixture is not the reviewed 86-policy state")
        post_before = daily_metadata(post)
        post_cron = cron_sentinel(post)
        invoke_and_require(post, healthy=False, policies=False)
        apply(post)
        post_after = daily_metadata(post)
        if post_after["oid"] != post_before["oid"]:
            fail("CBA-10 changed post-DB09 daily health function OID")
        for field in ("owner", "security_definer", "config", "acl"):
            if post_after[field] != post_before[field]:
                fail(f"CBA-10 changed post-DB09 daily health {field}")
        if cron_sentinel(post) != post_cron:
            fail("CBA-10 changed post-DB09 synthetic Cron sentinel")
        invoke_and_require(post, healthy=True, policies=True)
        record(
            checks,
            "complete reviewed DB09-consolidated 86-policy multi-policy state is also healthy without accepting a partial transition",
        )

        phase = "current-receipt-wrapper-preservation"
        receipt = _fixture.bootstrap_database(
            port,
            "cba10_current_receipt_" + secrets.token_hex(8),
            variants,
            policy_rows=variants[CURRENT_STATE],
            with_critical_helper=True,
        )
        _fixture.apply(receipt, _fixture.EXTENSION)
        _fixture.apply(receipt, _fixture.POLICY_NAME_PATCH)
        _receipt_fixture.establish_current_receipt_state(receipt)
        receipt.execute(
            (PROJECT_ROOT / _receipt_fixture.RECONCILIATION_SQL).read_text(encoding="utf-8")
        )
        receipt.execute(
            (PROJECT_ROOT / _receipt_fixture.DAILY_WRAPPER_SQL).read_text(encoding="utf-8")
        )
        receipt_before = daily_metadata(receipt)
        if receipt_before["definition_md5"] != "02c6415bd9f2715b4bae502b1ed934bb":
            fail("synthetic current receipt wrapper did not reach the reviewed final definition")
        if receipt_before["body_md5"] != "c9042815f6e02dcfbfe958a30eb7afae":
            fail("synthetic current receipt wrapper did not reach the reviewed final body")
        _receipt_fixture.assert_daily_history(receipt, True)
        apply(receipt)
        if daily_metadata(receipt) != receipt_before:
            fail("CBA-10 changed the exact reviewed current receipt wrapper")
        _receipt_fixture.assert_daily_history(receipt, True)
        record(
            checks,
            "the exact current receipt-compatible wrapper is an executed no-op and retains its healthy receipt contract",
        )

        phase = "unreviewed-baseline-refusal"
        drift = create_database(
            port,
            "cba10_drift_" + secrets.token_hex(8),
            variants,
            policy_rows=variants[CURRENT_STATE],
        )
        drift_before = daily_metadata(drift)
        drift.execute(
            """
            CREATE OR REPLACE FUNCTION circles_ops.run_daily_migration_health()
            RETURNS TABLE(run_id bigint, ran_at timestamptz, healthy boolean, error_code text)
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
            AS $cba10_drift$ BEGIN RETURN; END; $cba10_drift$
            """
        )
        changed = daily_metadata(drift)
        if changed["oid"] != drift_before["oid"]:
            fail("drift fixture did not preserve the existing daily function OID")
        expect_error(lambda: apply(drift), "exact reviewed source, post-policy, or current receipt")
        drift.rollback()
        if daily_metadata(drift) != changed:
            fail("CBA-10 refusal changed an unreviewed daily health body")
        record(checks, "an unreviewed daily-health definition is refused before predicate replacement")

        evidence.update(
            {
                "passed": True,
                "postgres_major": 17,
                "source_migrations_replayed_per_database": len(_fixture._fixture.MIGRATIONS),
                "policy_variants": {CURRENT_STATE: 96, POST_CONSOLIDATION_STATE: 86},
                "negative_cases": [
                    "extra_policy",
                    "changed_policy",
                    "removed_policy",
                    "reapplication",
                    "unreviewed_baseline",
                ],
                "current_receipt_wrapper_noop_executed": True,
                "checks": checks,
            }
        )
    except Exception as error:
        evidence.update(
            {
                "failed_phase": phase,
                "error_category": type(error).__name__,
                "failure_reason": str(error)[:300],
            }
        )
    finally:
        for connection in (drift, receipt, post, current):
            if connection is not None:
                connection.close()
        if temporary is not None and started and environment is not None:
            try:
                checked(
                    [
                        str(PG_BIN / "pg_ctl"),
                        "-D",
                        str(temporary / "data"),
                        "-m",
                        "immediate",
                        "-w",
                        "stop",
                    ],
                    environment,
                )
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
