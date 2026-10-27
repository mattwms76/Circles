#!/usr/bin/env python3
"""Opt-in disposable PostgreSQL 17 drill for DB-14 critical database contracts.

The drill creates one unique, loopback-only cluster with synthetic metadata. It accepts no DSN,
reads no .env file, and never starts an application service or contacts a provider. Set
CIRCLES_DB14_LOCAL_PG17=1 to run it from the repository root.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
from typing import NoReturn

import psycopg
from psycopg.rows import dict_row


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PG_BIN = Path("/usr/lib/postgresql/17/bin")
FIXTURE_DATABASE = "db14_fixture_" + secrets.token_hex(12)
MIGRATIONS = (
    "drizzle/postgres/0000_circles_app.sql",
    "operations/migrations/0001_circles_ops_daily_migration_health.sql",
    "operations/migrations/0002_circles_auth_oauth_pending.sql",
    "operations/migrations/0004_circles_app_integrity.sql",
    "operations/migrations/0005_circles_message_trigger_least_privilege.sql",
    "operations/migrations/0003_circles_ops_history_fallback.sql",
    "operations/migrations/0006_circles_profile_onboarding.sql",
    "operations/migrations/0007_circles_ops_onboarding_health.sql",
    "operations/migrations/0008_circles_home.sql",
    "operations/migrations/0009_circles_ops_circle_home_health.sql",
    "operations/migrations/0010_circles_activity_inbox.sql",
    "operations/migrations/0011_circles_ops_activity_health.sql",
    "operations/migrations/0012_circles_moderation.sql",
    "operations/migrations/0013_circles_ops_moderation_health.sql",
    "operations/migrations/0014_circles_email_identity.sql",
    "operations/migrations/0015_circles_publish_post_receipts.sql",
)
DB14_MIGRATION = "operations/remediation/db14_integrity_health.sql"
EXPECTED_FOREIGN_KEYS = {
    "messages_conversationId_fkey",
    "messages_authorId_fkey",
    "conversationParticipants_conversationId_fkey",
    "conversationParticipants_userId_fkey",
    "conversations_circleId_fkey",
}


def fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def fixture_environment(home: Path) -> dict[str, str]:
    """Use an explicit allowlist so inherited DSNs and credentials cannot reach children."""
    return {
        "HOME": str(home),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PATH": f"{PG_BIN}:/usr/bin:/bin",
    }


def checked(argv: list[str], env: dict[str, str], *, timeout: int = 90) -> None:
    result = subprocess.run(
        argv,
        cwd=PROJECT_ROOT,
        env=env,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode:
        fail("disposable PostgreSQL command failed")


def reserve_loopback_port() -> int:
    for _ in range(32):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = int(reservation.getsockname()[1])
        if port not in (3000, 8081):
            return port
    fail("unable to reserve a local fixture port")


def source_template(name: str) -> str:
    """Extract one reviewed template literal without importing application runtime modules."""
    source = (PROJECT_ROOT / "server/_core/database-contracts.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(
        rf"export const {re.escape(name)} = `([\s\S]*?)`;", source
    )
    if not match:
        fail(f"unable to locate {name}")
    template = match.group(1)
    fingerprint_match = re.search(
        r'MESSAGE_AUTHORIZATION_FUNCTION_PROSRC_MD5\s*=\s*"([0-9a-f]{32})"',
        source,
    )
    if not fingerprint_match:
        fail("unable to locate source-owned message function fingerprint")
    return template.replace(
        "${MESSAGE_AUTHORIZATION_FUNCTION_PROSRC_MD5}", fingerprint_match.group(1)
    )


def source_fingerprint() -> str:
    source = (PROJECT_ROOT / "server/_core/database-contracts.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(
        r'MESSAGE_AUTHORIZATION_FUNCTION_PROSRC_MD5\s*=\s*"([0-9a-f]{32})"',
        source,
    )
    if not match:
        fail("message function fingerprint is unavailable")
    return match.group(1)


def apply_migrations(connection: psycopg.Connection[dict[str, object]]) -> None:
    connection.execute(
        """
        CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
        CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
        CREATE ROLE service_role NOLOGIN NOSUPERUSER NOBYPASSRLS;
        """
    )
    for relative_path in MIGRATIONS:
        connection.execute((PROJECT_ROOT / relative_path).read_text(encoding="utf-8"))
    # This source-owned browser denial was rolled out separately from the 0000–0015 baseline.
    # It is fixture-only: runtime policy checks must validate the installed production shape, not
    # weaken their contract because an isolated synthetic baseline predates that rollout.
    connection.execute(
        """
        CREATE POLICY circles_app_deny_anon_authenticated
          ON circles_app.messages
          AS RESTRICTIVE
          FOR ALL
          TO anon, authenticated
          USING (false)
          WITH CHECK (false)
        """
    )


def scalar_bool(connection: psycopg.Connection[dict[str, object]], statement: str) -> bool:
    row = connection.execute(statement).fetchone()
    if row is None or len(row) != 1:
        fail("catalog probe did not return one boolean")
    return next(iter(row.values())) is True


def assert_runtime_contracts(connection: psycopg.Connection[dict[str, object]]) -> None:
    database_sql = source_template("DATABASE_READINESS_SQL")
    email_sql = source_template("EMAIL_IDENTITY_READINESS_SQL")
    publication_sql = source_template("POST_PUBLICATION_STATUS_SQL")
    connection.execute("SET ROLE circles_app_runtime")
    try:
        readiness = connection.execute(database_sql).fetchone()
        if readiness is None:
            fail("database readiness returned no evidence")
        if readiness.get("runtime_role") != "circles_app_runtime":
            fail("runtime readiness used the wrong current role")
        if readiness.get("app_table_count") != 27:
            fail("runtime readiness app-table inventory drifted")
        if readiness.get("oauth_store_ready") is not True:
            fail("runtime OAuth readiness was not healthy")
        if readiness.get("critical_contract_ready") is not True:
            fail("runtime critical catalog contract was not healthy")
        if not scalar_bool(connection, email_sql):
            fail("runtime email identity catalog contract was not healthy")
        if not scalar_bool(connection, publication_sql):
            fail("runtime publication receipt catalog contract was not healthy")
    finally:
        connection.execute("RESET ROLE")


def assert_health(
    connection: psycopg.Connection[dict[str, object]], expected_healthy: bool
) -> None:
    row = connection.execute(
        "SELECT healthy, error_code FROM circles_ops.run_daily_critical_feature_health()"
    ).fetchone()
    if row is None or row.get("healthy") is not expected_healthy:
        fail("critical health result did not fail closed as expected")
    if expected_healthy and row.get("error_code") is not None:
        fail("healthy critical health result exposed an error code")
    if not expected_healthy and row.get("error_code") != "critical_feature_catalog_drift":
        fail("drift result was not sanitized")


def assert_critical_not_ready(connection: psycopg.Connection[dict[str, object]]) -> None:
    database_sql = source_template("DATABASE_READINESS_SQL")
    connection.execute("SET ROLE circles_app_runtime")
    try:
        row = connection.execute(database_sql).fetchone()
        if row is None or row.get("critical_contract_ready") is not False:
            fail("runtime critical readiness did not fail closed")
    finally:
        connection.execute("RESET ROLE")


def assert_health_function_acl(connection: psycopg.Connection[dict[str, object]]) -> None:
    catalog = connection.execute(
        """
        SELECT
          owner_catalog.rolname AS owner,
          function_catalog.prosecdef AS security_definer,
          function_catalog.proconfig AS config
        FROM pg_catalog.pg_proc AS function_catalog
        JOIN pg_catalog.pg_namespace AS namespace_catalog
          ON namespace_catalog.oid = function_catalog.pronamespace
        JOIN pg_catalog.pg_roles AS owner_catalog
          ON owner_catalog.oid = function_catalog.proowner
        WHERE namespace_catalog.nspname = 'circles_ops'
          AND function_catalog.proname = 'run_daily_critical_feature_health'
          AND function_catalog.pronargs = 0
        """
    ).fetchone()
    if catalog != {
        "owner": "postgres",
        "security_definer": True,
        "config": ["search_path=pg_catalog"],
    }:
        fail("critical health function owner/security/path contract drifted")
    acl = connection.execute(
        """
        SELECT role_catalog.rolname AS grantee, acl_entry.privilege_type,
               acl_entry.is_grantable
        FROM pg_catalog.pg_proc AS function_catalog
        JOIN pg_catalog.pg_namespace AS namespace_catalog
          ON namespace_catalog.oid = function_catalog.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(function_catalog.proacl) AS acl_entry
        LEFT JOIN pg_catalog.pg_roles AS role_catalog ON role_catalog.oid = acl_entry.grantee
        WHERE namespace_catalog.nspname = 'circles_ops'
          AND function_catalog.proname = 'run_daily_critical_feature_health'
          AND function_catalog.pronargs = 0
        ORDER BY role_catalog.rolname NULLS FIRST, acl_entry.privilege_type
        """
    ).fetchall()
    if acl != [
        {"grantee": "postgres", "privilege_type": "EXECUTE", "is_grantable": False}
    ]:
        fail("critical health function retains PUBLIC, unexpected, or grant-option ACLs")


def expect_sql_error(operation, expected_fragment: str) -> None:
    try:
        operation()
    except psycopg.Error as error:
        if expected_fragment not in str(error):
            fail("expected local migration rejection category was not returned")
    else:
        fail("expected local migration rejection did not occur")


def apply_db14(connection: psycopg.Connection[dict[str, object]]) -> None:
    connection.execute((PROJECT_ROOT / DB14_MIGRATION).read_text(encoding="utf-8"))


def main() -> int:
    if os.environ.get("CIRCLES_DB14_LOCAL_PG17") != "1":
        print("SKIP: set CIRCLES_DB14_LOCAL_PG17=1 for the disposable local PostgreSQL 17 DB-14 drill")
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
    started = False
    connection: psycopg.Connection[dict[str, object]] | None = None
    try:
        if not (PG_BIN / "initdb").is_file() or not (PG_BIN / "pg_ctl").is_file():
            fail("PostgreSQL 17 fixture binaries are unavailable")
        if "CREATE OR REPLACE FUNCTION circles_ops.run_daily_critical_feature_health" in (
            PROJECT_ROOT / DB14_MIGRATION
        ).read_text(encoding="utf-8"):
            fail("DB-14 health must use CREATE FUNCTION, never ACL-retaining replacement")
        migration_text = (PROJECT_ROOT / DB14_MIGRATION).read_text(encoding="utf-8")
        if "SET LOCAL lock_timeout = '2s';" not in migration_text or "SET LOCAL statement_timeout = '15s';" not in migration_text:
            fail("DB-14 health migration lacks bounded transaction settings")

        temporary = Path(tempfile.mkdtemp(prefix="circles-db14-critical-pg17-"))
        temporary.chmod(0o700)
        environment = fixture_environment(temporary)
        port = reserve_loopback_port()

        phase = "initdb"
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
        phase = "start-local-postgres"
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

        phase = "apply-source-migrations"
        with psycopg.connect(
            host="127.0.0.1",
            port=port,
            dbname="postgres",
            user="postgres",
            connect_timeout=5,
            autocommit=True,
        ) as bootstrap:
            bootstrap.execute(f'CREATE DATABASE "{FIXTURE_DATABASE}"')
        connection = psycopg.connect(
            host="127.0.0.1",
            port=port,
            dbname=FIXTURE_DATABASE,
            user="postgres",
            connect_timeout=5,
            autocommit=True,
            row_factory=dict_row,
        )
        apply_migrations(connection)

        phase = "verify-source-fingerprints-and-names"
        social_uploads = connection.execute(
            "SELECT pg_catalog.to_regclass('circles_app.socialUploads') AS folded, "
            "pg_catalog.to_regclass('circles_app.\"socialUploads\"') AS exact"
        ).fetchone()
        if social_uploads is None or social_uploads["folded"] is not None or social_uploads["exact"] is None:
            fail("mixed-case social uploads relation did not require the exact quoted regclass")
        fingerprint = connection.execute(
            "SELECT pg_catalog.md5(prosrc) AS fingerprint "
            "FROM pg_catalog.pg_proc "
            "WHERE oid = 'circles_app.enforce_message_author_authorized()'::pg_catalog.regprocedure"
        ).fetchone()
        if fingerprint is None or fingerprint["fingerprint"] != source_fingerprint():
            fail("actual PG17 trigger function fingerprint differs from source contract")
        foreign_keys = connection.execute(
            """
            SELECT constraint_catalog.conname
            FROM pg_catalog.pg_constraint AS constraint_catalog
            JOIN pg_catalog.pg_namespace AS namespace_catalog
              ON namespace_catalog.oid = constraint_catalog.connamespace
            WHERE namespace_catalog.nspname = 'circles_app'
              AND constraint_catalog.conname = ANY(%s::text[])
            """,
            (list(EXPECTED_FOREIGN_KEYS),),
        ).fetchall()
        if {str(row["conname"]) for row in foreign_keys} != EXPECTED_FOREIGN_KEYS:
            fail("actual PG17 FK names differ from DB-14's exact camel-case contract")

        phase = "apply-db14-and-healthy-contracts"
        apply_db14(connection)
        assert_health_function_acl(connection)
        assert_runtime_contracts(connection)
        assert_health(connection, True)
        connection.execute("SET ROLE circles_app_runtime")
        try:
            expect_sql_error(
                lambda: connection.execute(
                    "SELECT * FROM circles_ops.run_daily_critical_feature_health()"
                ),
                "permission denied",
            )
        finally:
            connection.execute("RESET ROLE")

        phase = "duplicate-signature-refusal"
        expect_sql_error(lambda: apply_db14(connection), "already exists")
        connection.rollback()
        assert_health_function_acl(connection)

        phase = "negative-column"
        connection.execute('ALTER TABLE circles_app."socialUploads" DROP COLUMN "claimedAt"')
        assert_critical_not_ready(connection)
        assert_health(connection, False)
        connection.execute('ALTER TABLE circles_app."socialUploads" ADD COLUMN "claimedAt" timestamptz')
        assert_runtime_contracts(connection)
        assert_health(connection, True)

        phase = "negative-index"
        connection.execute("DROP INDEX circles_app.messages_conversation_author_client_message_id_unique")
        assert_critical_not_ready(connection)
        assert_health(connection, False)
        connection.execute(
            'CREATE UNIQUE INDEX messages_conversation_author_client_message_id_unique '
            'ON circles_app.messages ("conversationId", "authorId", "clientMessageId") '
            'WHERE "clientMessageId" IS NOT NULL'
        )
        assert_runtime_contracts(connection)
        assert_health(connection, True)

        phase = "negative-policy"
        connection.execute("DROP POLICY runtime_messages_policy ON circles_app.messages")
        assert_critical_not_ready(connection)
        assert_health(connection, False)
        connection.execute(
            "CREATE POLICY runtime_messages_policy ON circles_app.messages FOR ALL "
            "TO circles_app_runtime USING (true) WITH CHECK (true)"
        )
        assert_runtime_contracts(connection)
        assert_health(connection, True)

        phase = "negative-helper-acl"
        connection.execute(
            "GRANT EXECUTE ON FUNCTION circles_app.enforce_message_author_authorized() TO PUBLIC"
        )
        assert_critical_not_ready(connection)
        assert_health(connection, False)
        connection.execute(
            "REVOKE ALL ON FUNCTION circles_app.enforce_message_author_authorized() FROM PUBLIC"
        )
        assert_runtime_contracts(connection)
        assert_health(connection, True)

        phase = "malicious-prior-signature-refusal"
        connection.execute("DROP FUNCTION circles_ops.run_daily_critical_feature_health()")
        connection.execute(
            """
            CREATE FUNCTION circles_ops.run_daily_critical_feature_health()
            RETURNS TABLE (healthy boolean, error_code text)
            LANGUAGE sql
            SECURITY DEFINER
            SET search_path = pg_catalog
            AS $malicious$ SELECT true, NULL::text $malicious$
            """
        )
        connection.execute(
            "GRANT EXECUTE ON FUNCTION circles_ops.run_daily_critical_feature_health() TO PUBLIC"
        )
        expect_sql_error(lambda: apply_db14(connection), "already exists")
        connection.rollback()
        retained_public = connection.execute(
            """
            SELECT EXISTS (
              SELECT 1
              FROM pg_catalog.pg_proc AS function_catalog
              JOIN pg_catalog.pg_namespace AS namespace_catalog
                ON namespace_catalog.oid = function_catalog.pronamespace
              CROSS JOIN LATERAL pg_catalog.aclexplode(function_catalog.proacl) AS acl_entry
              WHERE namespace_catalog.nspname = 'circles_ops'
                AND function_catalog.proname = 'run_daily_critical_feature_health'
                AND function_catalog.pronargs = 0
                AND acl_entry.grantee = 0
            ) AS retained_public
            """
        ).fetchone()
        if retained_public is None or retained_public["retained_public"] is not True:
            fail("prior malicious fixture did not retain its ACL after fail-closed refusal")

        evidence.update(
            {
                "passed": True,
                "postgres_major": 17,
                "migrations_applied": len(MIGRATIONS),
                "negative_cases": ["column", "index", "policy", "helper_acl", "prior_signature"],
                "runtime_queries": [
                    "DATABASE_READINESS_SQL",
                    "EMAIL_IDENTITY_READINESS_SQL",
                    "POST_PUBLICATION_STATUS_SQL",
                ],
            }
        )
    except Exception as error:
        evidence.update({"failed_phase": phase, "error_category": type(error).__name__})
    finally:
        if connection is not None:
            connection.close()
        if temporary is not None and started:
            try:
                checked(
                    [str(PG_BIN / "pg_ctl"), "-D", str(temporary / "data"), "-m", "immediate", "-w", "stop"],
                    fixture_environment(temporary),
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
