#!/usr/bin/env python3
"""Opt-in isolated PostgreSQL 17 rehearsal for the DB-14 daily-health extension.

Run only from the repository root with an explicit opt-in:
  env -i PATH="$PATH" HOME=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    CIRCLES_DB14_DAILY_HEALTH_EXTENSION_LOCAL_PG17=1 \
    /usr/bin/python3 -B operations/tests/db14-daily-health-extension.pg17.py

The drill accepts no DSN, reads no .env, binds a fresh cluster only to loopback, and never
contacts a provider. It materializes the exact reviewed ``circles_app`` policy states from
``scripts/circles-database-security-contract.mjs`` and first verifies the 96-row current
variant against the read-only 2026-10-27 captured policy catalog. The ``cron.job`` row is a
test-owned sentinel, not pg_cron or provider metadata.
"""
from __future__ import annotations

import importlib.util
import hashlib
import json
import os
from pathlib import Path
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
NODE_BIN = Path(shutil.which("node") or "")
CRITICAL_HELPER = "operations/remediation/db14_integrity_health.sql"
EXTENSION = "operations/remediation/db14_daily_health_extension.sql"
CAPTURED_CURRENT_POLICY_SHA256 = "1dc3333f36739e281f2a0587d11e509aedb5ba804c588c6ca09c9e58f9aaa449"
GOLDEN_DAILY_DEFINITION_MD5 = "a4421c8c4e64f1700f2a2771624ecfa0"
GOLDEN_DAILY_BODY_MD5 = "e508c15fe21081e43c41810df71b5677"
CURRENT_POLICY_STATE = "current_pre_db09"
POST_CONSOLIDATION_POLICY_STATE = "post_db09_12_group_consolidation"
EXPECTED_POLICY_COUNTS = {
    CURRENT_POLICY_STATE: 96,
    POST_CONSOLIDATION_POLICY_STATE: 86,
}


_fixture_spec = importlib.util.spec_from_file_location(
    "db14_critical_fixture", PROJECT_ROOT / "operations/tests/db14-critical-contracts.pg17.py"
)
if _fixture_spec is None or _fixture_spec.loader is None:
    raise RuntimeError("unable to load the read-only DB-14 critical fixture bootstrap")
_fixture = importlib.util.module_from_spec(_fixture_spec)
_fixture_spec.loader.exec_module(_fixture)


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
    fail("unable to reserve a local fixture port")


def extension_sql() -> str:
    return (PROJECT_ROOT / EXTENSION).read_text(encoding="utf-8")


def apply(connection: psycopg.Connection[dict[str, object]], relative_path: str) -> None:
    connection.execute((PROJECT_ROOT / relative_path).read_text(encoding="utf-8"))


def apply_source_migration(
    connection: psycopg.Connection[dict[str, object]], relative_path: str
) -> None:
    """Replay source SQL unchanged except for its already-existing cluster-global role."""
    migration = (PROJECT_ROOT / relative_path).read_text(encoding="utf-8")
    if relative_path == "drizzle/postgres/0000_circles_app.sql":
        role_exists = connection.execute(
            "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'circles_app_runtime') AS exists"
        ).fetchone()
        if role_exists is None:
            fail("unable to inspect the synthetic cluster runtime role")
        if role_exists["exists"] is True:
            statement = "CREATE ROLE circles_app_runtime NOLOGIN NOINHERIT NOBYPASSRLS;\n"
            if migration.count(statement) != 1:
                fail("source baseline runtime-role statement drifted")
            migration = migration.replace(statement, "", 1)
    connection.execute(migration)


def expect_error(operation: Callable[[], object], fragment: str) -> None:
    try:
        operation()
    except psycopg.Error as error:
        if fragment not in str(error):
            fail(f"expected refusal containing {fragment!r}")
    else:
        fail("expected guarded SQL refusal")


def policy_tuple_from_contract(row: dict[str, object]) -> tuple[object, ...]:
    roles = row.get("roles")
    if not isinstance(roles, list) or not all(isinstance(role, str) for role in roles):
        fail("canonical policy contract contains malformed role data")
    command = row.get("command")
    permissive = row.get("permissive")
    if command not in {"ALL", "SELECT", "INSERT", "UPDATE", "DELETE"}:
        fail("canonical policy contract contains an unsupported app policy command")
    if permissive not in {"PERMISSIVE", "RESTRICTIVE"}:
        fail("canonical policy contract contains an unsupported app policy permissiveness")
    return (
        row.get("table_name"),
        row.get("policy_name"),
        tuple(sorted(roles)),
        command,
        permissive,
        row.get("using_qualification"),
        row.get("with_check_qualification"),
    )


def canonical_app_policy_variants() -> dict[str, list[dict[str, object]]]:
    """Read only the reviewed static contract under a stripped child environment."""
    if not NODE_BIN.is_file():
        fail("local Node binary required for the canonical policy contract is unavailable")
    program = """
import { POLICY_CONTRACT_VARIANTS as variants } from './scripts/circles-database-security-contract.mjs';
const selected = {
  current_pre_db09: 'pre_db09_duplicate_consolidation',
  post_db09_12_group_consolidation: 'post_db09_keep_parity_names',
};
const result = {};
for (const [state, key] of Object.entries(selected)) {
  result[state] = variants[key]
    .filter((row) => row.schema_name === 'circles_app')
    .map((row) => ({
      table_name: row.table_name,
      policy_name: row.policy_name,
      roles: [...row.roles].sort(),
      command: row.command,
      permissive: row.permissive,
      using_qualification: row.using_qualification,
      with_check_qualification: row.with_check_qualification,
    }));
}
process.stdout.write(JSON.stringify(result));
"""
    result = subprocess.run(
        [str(NODE_BIN), "--input-type=module", "--eval", program],
        cwd=PROJECT_ROOT,
        env={
            "HOME": "/tmp",
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "PATH": f"{NODE_BIN.parent}:/usr/bin:/bin",
        },
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        fail("unable to read the local canonical policy contract")
    try:
        variants = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("canonical policy contract did not produce JSON") from error
    if set(variants) != set(EXPECTED_POLICY_COUNTS):
        fail("canonical policy contract produced an unexpected variant set")
    for state, count in EXPECTED_POLICY_COUNTS.items():
        rows = variants.get(state)
        if not isinstance(rows, list) or len(rows) != count:
            fail(f"canonical {state} policy state does not have {count} rows")
        normalized_rows = [policy_tuple_from_contract(row) for row in rows]
        if len(set(normalized_rows)) != count:
            fail(f"canonical {state} policy state contains a duplicate policy record")
        if len({row[0] for row in normalized_rows}) != 27:
            fail(f"canonical {state} policy state does not cover all 27 app tables")
    return variants


def assert_current_contract_matches_captured_catalog(
    variants: dict[str, list[dict[str, object]]],
) -> None:
    """Match a portable digest independently pinned from the read-only actual catalog.

    Digest input is the sorted seven-field tuple representation of the 96
    circles_app policies captured on 2026-10-27, encoded as compact UTF-8 JSON.
    It contains schema metadata only; no user rows or external file is required.
    """
    rows = sorted(policy_tuple_from_contract(row) for row in variants[CURRENT_POLICY_STATE])
    if len(rows) != 96 or len({row[0] for row in rows}) != 27:
        fail("captured current app policy digest expects 96 rows across 27 tables")
    encoded = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if hashlib.sha256(encoded).hexdigest() != CAPTURED_CURRENT_POLICY_SHA256:
        fail("canonical current policy contract differs from the pinned actual catalog digest")


def observed_app_policies(
    connection: psycopg.Connection[dict[str, object]],
) -> set[tuple[object, ...]]:
    rows = connection.execute(
        """
        SELECT
          relation_catalog.relname::text AS table_name,
          policy_catalog.polname::text AS policy_name,
          COALESCE(
            array_agg(role_catalog.rolname::text ORDER BY role_catalog.rolname)
              FILTER (WHERE role_catalog.oid IS NOT NULL),
            ARRAY[]::text[]
          ) AS roles,
          CASE policy_catalog.polcmd
            WHEN '*' THEN 'ALL'
            WHEN 'r' THEN 'SELECT'
            WHEN 'a' THEN 'INSERT'
            WHEN 'w' THEN 'UPDATE'
            WHEN 'd' THEN 'DELETE'
            ELSE policy_catalog.polcmd::text
          END AS command,
          CASE WHEN policy_catalog.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS permissive,
          regexp_replace(
            pg_catalog.pg_get_expr(policy_catalog.polqual, policy_catalog.polrelid),
            '[[:space:]]+',
            ' ',
            'g'
          ) AS using_qualification,
          regexp_replace(
            pg_catalog.pg_get_expr(policy_catalog.polwithcheck, policy_catalog.polrelid),
            '[[:space:]]+',
            ' ',
            'g'
          ) AS with_check_qualification
        FROM pg_catalog.pg_policy AS policy_catalog
        JOIN pg_catalog.pg_class AS relation_catalog
          ON relation_catalog.oid = policy_catalog.polrelid
        JOIN pg_catalog.pg_namespace AS namespace_catalog
          ON namespace_catalog.oid = relation_catalog.relnamespace
        LEFT JOIN LATERAL pg_catalog.unnest(policy_catalog.polroles) AS policy_role(role_oid)
          ON true
        LEFT JOIN pg_catalog.pg_roles AS role_catalog
          ON role_catalog.oid = policy_role.role_oid
        WHERE namespace_catalog.nspname = 'circles_app'
        GROUP BY policy_catalog.oid, relation_catalog.relname
        """
    ).fetchall()
    return {
        (
            row["table_name"],
            row["policy_name"],
            tuple(row["roles"]),
            row["command"],
            row["permissive"],
            row["using_qualification"],
            row["with_check_qualification"],
        )
        for row in rows
    }


def expected_policy_rows(rows: list[dict[str, object]]) -> set[tuple[object, ...]]:
    return {policy_tuple_from_contract(row) for row in rows}


def create_policy_from_contract(
    connection: psycopg.Connection[dict[str, object]], row: dict[str, object]
) -> None:
    table_name = row["table_name"]
    policy_name = row["policy_name"]
    roles = row["roles"]
    command = row["command"]
    permissive = row["permissive"]
    using_qualification = row["using_qualification"]
    with_check_qualification = row["with_check_qualification"]
    if not (
        isinstance(table_name, str)
        and isinstance(policy_name, str)
        and isinstance(roles, list)
        and all(isinstance(role, str) for role in roles)
        and isinstance(command, str)
        and isinstance(permissive, str)
        and (using_qualification is None or isinstance(using_qualification, str))
        and (with_check_qualification is None or isinstance(with_check_qualification, str))
    ):
        fail("canonical policy contract row is malformed")
    statement = sql.SQL("CREATE POLICY {} ON {}.{} AS {} FOR {} TO {}").format(
        sql.Identifier(policy_name),
        sql.Identifier("circles_app"),
        sql.Identifier(table_name),
        sql.SQL(permissive),
        sql.SQL(command),
        sql.SQL(", ").join(sql.Identifier(role) for role in roles),
    )
    if using_qualification is not None:
        statement += sql.SQL(" USING ({})").format(sql.SQL(using_qualification))
    if with_check_qualification is not None:
        statement += sql.SQL(" WITH CHECK ({})").format(sql.SQL(with_check_qualification))
    connection.execute(statement)


def install_exact_policy_state(
    connection: psycopg.Connection[dict[str, object]], rows: list[dict[str, object]]
) -> None:
    expected = expected_policy_rows(rows)
    existing = observed_app_policies(connection)
    expected_by_name = {(row[0], row[1]): row for row in expected}
    for existing_row in existing:
        name = (existing_row[0], existing_row[1])
        if name not in expected_by_name or existing_row != expected_by_name[name]:
            fail("source replay app policy does not match the reviewed current source contract")
    for row in rows:
        key = (row["table_name"], row["policy_name"])
        if key not in {(existing_row[0], existing_row[1]) for existing_row in existing}:
            create_policy_from_contract(connection, row)
    actual = observed_app_policies(connection)
    if actual != expected:
        fail("exact reviewed policy fixture installation did not converge")
    browser_denials = [
        row
        for row in actual
        if row[1] == "circles_app_deny_anon_authenticated"
        and row[2] == ("anon", "authenticated")
        and row[3:] == ("ALL", "RESTRICTIVE", "false", "false")
    ]
    if len(browser_denials) != 27:
        fail("full source fixture does not retain restrictive browser denials on all 27 app tables")


def daily_catalog(connection: psycopg.Connection[dict[str, object]]) -> dict[str, object]:
    row = connection.execute(
        """
        SELECT
          function_catalog.oid::text AS oid,
          pg_catalog.md5(pg_catalog.pg_get_functiondef(function_catalog.oid)) AS definition_md5,
          pg_catalog.md5(function_catalog.prosrc) AS body_md5,
          owner_catalog.rolname AS owner,
          function_catalog.prosecdef AS security_definer,
          function_catalog.proconfig AS config,
          function_catalog.proacl::text AS acl,
          pg_catalog.pg_get_functiondef(function_catalog.oid) AS definition
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
        fail("daily health function was not installed in the synthetic fixture")
    return row


def cron_job_7(connection: psycopg.Connection[dict[str, object]]) -> dict[str, object]:
    row = connection.execute(
        "SELECT jobid, schedule, username::text AS username, active FROM cron.job WHERE jobid = 7"
    ).fetchone()
    if row is None:
        fail("synthetic job-7 sentinel disappeared")
    return row


def bootstrap_database(
    port: int,
    name: str,
    variants: dict[str, list[dict[str, object]]],
    *,
    policy_state: str = CURRENT_POLICY_STATE,
    with_critical_helper: bool = True,
) -> psycopg.Connection[dict[str, object]]:
    if policy_state not in variants:
        fail("unknown requested exact policy fixture state")
    with psycopg.connect(
        host="127.0.0.1",
        port=port,
        dbname="postgres",
        user="postgres",
        connect_timeout=5,
        autocommit=True,
    ) as control:
        control.execute(f'CREATE DATABASE "{name}"')
    connection = psycopg.connect(
        host="127.0.0.1",
        port=port,
        dbname=name,
        user="postgres",
        connect_timeout=5,
        autocommit=True,
        row_factory=dict_row,
    )
    for migration in _fixture.MIGRATIONS:
        apply_source_migration(connection, migration)
    connection.execute(
        """
        DO $db14_fixture_roles$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles
            WHERE rolname = 'circles_admin_runtime'::pg_catalog.name
          ) THEN
            CREATE ROLE circles_admin_runtime LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles
            WHERE rolname = 'circles_admin_native_executor'::pg_catalog.name
          ) THEN
            CREATE ROLE circles_admin_native_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
          END IF;
        END;
        $db14_fixture_roles$;
        """
    )
    install_exact_policy_state(connection, variants[policy_state])
    connection.execute("CREATE SCHEMA cron")
    connection.execute(
        """
        CREATE TABLE cron.job (
          jobid integer PRIMARY KEY,
          schedule text NOT NULL,
          username name NOT NULL,
          active boolean NOT NULL
        )
        """
    )
    connection.execute(
        "INSERT INTO cron.job(jobid, schedule, username, active) VALUES (7, '15 3 * * *', 'postgres', true)"
    )
    connection.execute(
        """
        INSERT INTO circles_app."_dataMigrations"(key, "sourceTree", "completedAt", summary)
        VALUES (
          'circles-mysql-to-supabase-v1',
          'manifest-sha256:1196b25e66280952d905d860e3488fa82af9d082983c5315f28ead30b35172a7',
          now(),
          '{}'::jsonb
        )
        """
    )
    if with_critical_helper:
        apply(connection, CRITICAL_HELPER)
    return connection


def assert_no_scheduler_statement(sql_text: str) -> None:
    forbidden = ("cron.", "pg_cron", "schedule(", "unschedule(")
    if any(token in sql_text.lower() for token in forbidden):
        fail("extension SQL contains a scheduler mutation/reference")
    if sql_text.count("v_policy_anchor constant text") != 1:
        fail("extension must contain exactly one guarded policy reconciliation anchor")
    if sql_text.count("v_anchor constant text") != 1:
        fail("extension must retain exactly one guarded critical-contract anchor")
    if sql_text.count("pg_catalog.replace(") != 2:
        fail("extension must use exactly two guarded replacements for its two reviewed anchors")
    if sql_text.count("count(policy_catalog.oid) <> 1") != 1:
        fail("obsolete policy count must appear only inside the exact old-policy anchor")
    if "current_pre_db09" not in sql_text or "post_db09_12_group_consolidation" not in sql_text:
        fail("extension does not declare both complete accepted app-policy states")
    if "CREATE OR REPLACE FUNCTION circles_ops.run_daily_migration_health" in sql_text:
        fail("extension must not carry a hand-copied daily health definition")


def assert_baseline_golden(connection: psycopg.Connection[dict[str, object]]) -> dict[str, object]:
    catalog = daily_catalog(connection)
    if catalog["definition_md5"] != GOLDEN_DAILY_DEFINITION_MD5:
        fail("source replay does not normalize to the captured daily definition MD5")
    if catalog["body_md5"] != GOLDEN_DAILY_BODY_MD5:
        fail("source replay does not normalize to the captured daily body MD5")
    expected_metadata = {
        "owner": "postgres",
        "security_definer": True,
        "config": ["search_path=pg_catalog"],
        "acl": "{postgres=X/postgres}",
    }
    for name, expected in expected_metadata.items():
        if catalog[name] != expected:
            fail(f"source replay daily metadata drifted at {name}")
    return catalog


def invoke_daily(connection: psycopg.Connection[dict[str, object]]) -> dict[str, object]:
    row = connection.execute(
        "SELECT run_id, ran_at, healthy, error_code FROM circles_ops.run_daily_migration_health()"
    ).fetchone()
    if row is None:
        fail("daily health returned no row")
    return row


def latest_checks(connection: psycopg.Connection[dict[str, object]]) -> dict[str, object]:
    row = connection.execute(
        "SELECT checks FROM circles_ops.health_runs ORDER BY run_id DESC LIMIT 1"
    ).fetchone()
    if row is None or not isinstance(row.get("checks"), dict):
        fail("daily health did not persist a checks object")
    return row["checks"]


def history_count(connection: psycopg.Connection[dict[str, object]]) -> int:
    row = connection.execute("SELECT count(*) AS count FROM circles_ops.health_runs").fetchone()
    if row is None:
        fail("health history count was unavailable")
    return int(row["count"])


def invoke_and_require(
    connection: psycopg.Connection[dict[str, object]],
    *,
    healthy: bool,
    critical: bool | None = None,
    policies: bool | None = None,
) -> dict[str, object]:
    before = history_count(connection)
    result = invoke_daily(connection)
    if result["healthy"] is not healthy:
        fail(f"daily health returned unexpected healthy value: {result!r}")
    if result["error_code"] != (None if healthy else "drift_detected"):
        fail(f"daily health returned unexpected error code: {result!r}")
    checks = latest_checks(connection)
    if critical is not None and checks.get("critical_feature_contract") is not critical:
        fail("daily health did not persist the expected critical_feature_contract result")
    if policies is not None and checks.get("backend_policies_restricted") is not policies:
        fail("daily health did not persist the expected closed policy-set result")
    if history_count(connection) != before + 1:
        fail("daily health did not append exactly one history row")
    return checks


def require_direct_execute_denial(
    connection: psycopg.Connection[dict[str, object]], role: str
) -> None:
    connection.execute(sql.SQL("SET ROLE {}").format(sql.Identifier(role)))
    try:
        expect_error(
            lambda: connection.execute("SELECT * FROM circles_ops.run_daily_migration_health()"),
            "permission denied",
        )
        expect_error(
            lambda: connection.execute(
                "SELECT * FROM circles_ops.run_daily_critical_feature_health()"
            ),
            "permission denied",
        )
    finally:
        connection.execute("RESET ROLE")


def restore_current_policy_state(
    connection: psycopg.Connection[dict[str, object]], variants: dict[str, list[dict[str, object]]]
) -> None:
    install_exact_policy_state(connection, variants[CURRENT_POLICY_STATE])


def main() -> int:
    if os.environ.get("CIRCLES_DB14_DAILY_HEALTH_EXTENSION_LOCAL_PG17") != "1":
        print(
            "SKIP: set CIRCLES_DB14_DAILY_HEALTH_EXTENSION_LOCAL_PG17=1 for the isolated PG17 drill"
        )
        return 0

    evidence: dict[str, object] = {
        "fixture": "fresh-local-postgresql-17-loopback-only",
        "policy_fixture": "canonical-contract-validated-against-read-only-captured-current-catalog",
        "production_access": False,
        "production_write": False,
        "provider_access": False,
        "cron_fixture": "synthetic-job-7-sentinel-not-pg-cron",
        "passed": False,
    }
    checks: list[str] = []
    directory: Path | None = None
    environment: dict[str, str] | None = None
    started = False
    current: psycopg.Connection[dict[str, object]] | None = None
    guard_connections: list[psycopg.Connection[dict[str, object]]] = []
    phase = "preflight"
    try:
        if not (PG_BIN / "initdb").is_file() or not (PG_BIN / "pg_ctl").is_file():
            fail("PostgreSQL 17 fixture binaries are unavailable")
        variants = canonical_app_policy_variants()
        assert_current_contract_matches_captured_catalog(variants)
        sql_text = extension_sql()
        assert_no_scheduler_statement(sql_text)
        record(checks, "extension has two guarded anchors, no scheduler operation, and canonical current data matches capture")

        directory = Path(tempfile.mkdtemp(prefix="circles-db14-daily-health-pg17-"))
        directory.chmod(0o700)
        environment = _fixture.fixture_environment(directory)
        port = reserve_loopback_port()

        phase = "initdb"
        checked(
            [
                str(PG_BIN / "initdb"),
                "-D",
                str(directory / "data"),
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
        phase = "start-local-postgres"
        checked(
            [
                str(PG_BIN / "pg_ctl"),
                "-D",
                str(directory / "data"),
                "-l",
                str(directory / "postgres.log"),
                "-o",
                f"-h 127.0.0.1 -p {port} -k {directory}",
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
                "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN"
            )
            control.execute("CREATE ROLE db14_unreviewed LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS")

        phase = "healthy-current-policy-state"
        current = bootstrap_database(port, "db14_current_" + secrets.token_hex(8), variants)
        before = assert_baseline_golden(current)
        before_cron = cron_job_7(current)
        if observed_app_policies(current) != expected_policy_rows(variants[CURRENT_POLICY_STATE]):
            fail("current fixture is not the complete 96-policy captured source state")
        helper_baseline = current.execute(
            "SELECT healthy, error_code FROM circles_ops.run_daily_critical_feature_health()"
        ).fetchone()
        if helper_baseline != {"healthy": True, "error_code": None}:
            fail(f"prepared critical helper baseline is not healthy: {helper_baseline!r}")
        apply(current, EXTENSION)
        after = daily_catalog(current)
        if after["oid"] != before["oid"]:
            fail("CREATE OR REPLACE did not preserve the daily function OID")
        for name in ("owner", "security_definer", "config", "acl"):
            if after[name] != before[name]:
                fail(f"daily function metadata changed at {name}")
        if after["definition_md5"] == before["definition_md5"]:
            fail("daily definition did not receive the reviewed DB-14 extension")
        if cron_job_7(current) != before_cron:
            fail("synthetic job-7 schedule or username changed during extension")
        invoke_and_require(current, healthy=True, critical=True, policies=True)
        if cron_job_7(current) != before_cron:
            fail("synthetic job-7 tuple changed after current-state healthy invocation")
        record(checks, "complete captured current policy state is healthy after extension with history, OID, metadata, and Cron sentinel preserved")

        phase = "browser-and-runtime-execution-denial"
        for role in ("circles_app_runtime", "anon", "authenticated"):
            require_direct_execute_denial(current, role)
        record(checks, "runtime and both browser roles remain denied direct execution of both protected health functions")

        phase = "added-policy-fails"
        current.execute(
            "CREATE POLICY db14_extra_messages_policy ON circles_app.messages FOR SELECT TO db14_unreviewed USING (false)"
        )
        invoke_and_require(current, healthy=False, critical=True, policies=False)
        current.execute("DROP POLICY db14_extra_messages_policy ON circles_app.messages")
        invoke_and_require(current, healthy=True, critical=True, policies=True)
        record(checks, "an added app policy fails the closed exact policy-set comparison and recovery continues history")

        phase = "changed-policy-fails"
        current.execute(
            "ALTER POLICY runtime_messages_policy ON circles_app.messages USING (false) WITH CHECK (false)"
        )
        invoke_and_require(current, healthy=False, critical=False, policies=False)
        current.execute(
            "ALTER POLICY runtime_messages_policy ON circles_app.messages USING (true) WITH CHECK (true)"
        )
        restore_current_policy_state(current, variants)
        invoke_and_require(current, healthy=True, critical=True, policies=True)
        record(checks, "a changed reviewed policy fails closed and exact recovery remains healthy")

        phase = "partial-policy-state-fails"
        current.execute("DROP POLICY circles_admin_read_circles ON circles_app.circles")
        invoke_and_require(current, healthy=False, critical=True, policies=False)
        restore_current_policy_state(current, variants)
        invoke_and_require(current, healthy=True, critical=True, policies=True)
        record(checks, "a partial DB-09 consolidation state fails rather than being treated as an allowed subset")

        phase = "browser-denial-fails"
        current.execute("DROP POLICY circles_app_deny_anon_authenticated ON circles_app.messages")
        invoke_and_require(current, healthy=False, critical=False, policies=False)
        restore_current_policy_state(current, variants)
        invoke_and_require(current, healthy=True, critical=True, policies=True)
        record(checks, "removing the required restrictive browser-denial policy fails both closed policy and critical contracts")

        phase = "negative-critical-contract-and-history"
        current.execute('ALTER TABLE circles_app."socialUploads" DROP COLUMN "claimedAt"')
        invoke_and_require(current, healthy=False, critical=False, policies=True)
        if cron_job_7(current) != before_cron:
            fail("synthetic job-7 tuple changed during negative critical contract")
        current.execute('ALTER TABLE circles_app."socialUploads" ADD COLUMN "claimedAt" timestamptz')
        invoke_and_require(current, healthy=True, critical=True, policies=True)
        if cron_job_7(current) != before_cron:
            fail("synthetic job-7 schedule or username changed during critical-contract recovery")
        record(checks, "negative critical drift fails closed while history continues and the Cron sentinel remains unchanged")

        phase = "healthy-post-consolidation-policy-state"
        post = bootstrap_database(
            port,
            "db14_post_db09_" + secrets.token_hex(8),
            variants,
            policy_state=POST_CONSOLIDATION_POLICY_STATE,
        )
        guard_connections.append(post)
        post_before = assert_baseline_golden(post)
        post_cron = cron_job_7(post)
        if observed_app_policies(post) != expected_policy_rows(variants[POST_CONSOLIDATION_POLICY_STATE]):
            fail("post-consolidation fixture is not the complete 86-policy state")
        helper_post = post.execute(
            "SELECT healthy, error_code FROM circles_ops.run_daily_critical_feature_health()"
        ).fetchone()
        if helper_post != {"healthy": True, "error_code": None}:
            fail("critical helper is not healthy in the complete post-consolidation state")
        apply(post, EXTENSION)
        if daily_catalog(post)["oid"] != post_before["oid"]:
            fail("post-consolidation extension changed the daily function OID")
        invoke_and_require(post, healthy=True, critical=True, policies=True)
        if cron_job_7(post) != post_cron:
            fail("synthetic job-7 tuple changed for the post-consolidation state")
        record(checks, "complete post-DB-09 twelve-group consolidation state is also healthy and preserves the Cron sentinel")

        phase = "double-apply-refusal"
        applied_snapshot = daily_catalog(current)
        expect_error(lambda: apply(current, EXTENSION), "golden definition")
        current.rollback()
        if daily_catalog(current) != applied_snapshot:
            fail("double apply changed the exact post-state after its refusal")
        record(checks, "double application refuses the non-golden post-state without mutation")

        phase = "changed-old-definition-refusal"
        changed = bootstrap_database(port, "db14_changed_" + secrets.token_hex(8), variants)
        guard_connections.append(changed)
        changed_before = daily_catalog(changed)
        changed.execute(
            """
            CREATE OR REPLACE FUNCTION circles_ops.run_daily_migration_health()
            RETURNS TABLE(run_id bigint, ran_at timestamptz, healthy boolean, error_code text)
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
            AS $changed$ BEGIN RETURN; END; $changed$
            """
        )
        changed_drift = daily_catalog(changed)
        if changed_drift["oid"] != changed_before["oid"]:
            fail("changed-old fixture failed to preserve its OID before refusal")
        expect_error(lambda: apply(changed, EXTENSION), "golden definition")
        changed.rollback()
        if daily_catalog(changed) != changed_drift:
            fail("changed-old refusal modified the drifted definition")
        record(checks, "changed old daily definition is refused before either anchor replacement")

        phase = "missing-helper-refusal"
        missing = bootstrap_database(
            port,
            "db14_missing_" + secrets.token_hex(8),
            variants,
            with_critical_helper=False,
        )
        guard_connections.append(missing)
        missing_before = daily_catalog(missing)
        expect_error(lambda: apply(missing, EXTENSION), "missing helper or overload drift")
        missing.rollback()
        if daily_catalog(missing) != missing_before:
            fail("missing-helper refusal modified daily health")
        record(checks, "missing critical helper is refused before either anchor replacement")

        phase = "extra-overload-refusal"
        overload = bootstrap_database(port, "db14_overload_" + secrets.token_hex(8), variants)
        guard_connections.append(overload)
        overload_before = daily_catalog(overload)
        overload.execute(
            "CREATE FUNCTION circles_ops.run_daily_migration_health(p_probe integer) RETURNS void LANGUAGE sql AS 'SELECT'"
        )
        expect_error(lambda: apply(overload, EXTENSION), "missing function or overload drift")
        overload.rollback()
        if daily_catalog(overload) != overload_before:
            fail("extra-overload refusal modified the zero-argument daily function")
        record(checks, "extra daily overload is refused before either anchor replacement")

        phase = "unreviewed-role-refusal"
        unreviewed = bootstrap_database(port, "db14_role_" + secrets.token_hex(8), variants)
        guard_connections.append(unreviewed)
        unreviewed_before = daily_catalog(unreviewed)
        unreviewed.execute("SET SESSION AUTHORIZATION db14_unreviewed")
        try:
            expect_error(lambda: apply(unreviewed, EXTENSION), "requires reviewed postgres session")
            unreviewed.rollback()
        finally:
            unreviewed.execute("RESET SESSION AUTHORIZATION")
        if daily_catalog(unreviewed) != unreviewed_before:
            fail("unreviewed-role refusal modified daily health")
        record(checks, "unreviewed installer role is refused before either anchor replacement")

        evidence.update(
            {
                "passed": True,
                "postgres_major": 17,
                "source_migrations_replayed": len(_fixture.MIGRATIONS),
                "policy_variants": {
                    CURRENT_POLICY_STATE: len(variants[CURRENT_POLICY_STATE]),
                    POST_CONSOLIDATION_POLICY_STATE: len(variants[POST_CONSOLIDATION_POLICY_STATE]),
                },
                "checks": checks,
                "negative_guards": [
                    "added_policy",
                    "changed_policy",
                    "partial_policy_state",
                    "browser_denial",
                    "double_apply",
                    "changed_old_definition",
                    "missing_helper",
                    "extra_daily_overload",
                    "unreviewed_installer_role",
                ],
            }
        )
    except Exception as error:
        evidence.update(
            {
                "failed_phase": phase,
                "error_category": type(error).__name__,
                "local_error": str(error)[:300],
            }
        )
    finally:
        for connection in guard_connections:
            connection.close()
        if current is not None:
            current.close()
        if directory is not None and started and environment is not None:
            try:
                checked(
                    [
                        str(PG_BIN / "pg_ctl"),
                        "-D",
                        str(directory / "data"),
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
        if directory is not None:
            try:
                shutil.rmtree(directory)
                evidence["disposable_fixture_removed"] = not directory.exists()
            except Exception:
                evidence["passed"] = False
                evidence["cleanup_error"] = "local_fixture_removal_failed"
    print(json.dumps(evidence, sort_keys=True))
    return 0 if evidence["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
