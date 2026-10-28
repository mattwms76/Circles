#!/usr/bin/env python3
"""Credential-free disposable PostgreSQL 17 proof for the inactive DB-01 candidate.

This runner creates its own loopback-only cluster and accepts no DSN, account, provider, or
fixture input. It tests PostgreSQL policy execution under the actual authenticated/anon/runtime
roles; OAuth issuance, provider gateway behavior, and production compatibility remain out of
scope.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Callable, Iterable

import psycopg
from psycopg import errors

ROOT = Path(__file__).resolve().parents[2]
FORWARD_SQL = ROOT / "operations/remediation/remaining_db01_legacy_public_privacy.sql"
ROLLBACK_SQL = ROOT / "operations/remediation/remaining_db01_legacy_public_privacy_rollback.sql"
PG_BIN = Path("/usr/lib/postgresql/17/bin")
INITDB = PG_BIN / "initdb"
PG_CTL = PG_BIN / "pg_ctl"

OWNER_A = "00000000-0000-0000-0000-0000000000a1"
OWNER_B = "00000000-0000-0000-0000-0000000000b2"
VIEWER_C = "00000000-0000-0000-0000-0000000000c3"

FORWARD_CONTRACT = "DB01_LEGACY_PUBLIC_PRIVACY_APPROVED_V1"
FORWARD_ACK = "DB01_OWNER_AND_COMPATIBILITY_ACKNOWLEDGED_V1"
ROLLBACK_CONTRACT = "DB01_LEGACY_PUBLIC_PRIVACY_ROLLBACK_APPROVED_V1"
ROLLBACK_ACK = "DB01_ROLLBACK_COMPATIBILITY_RESTORATION_ACKNOWLEDGED_V1"

ASSERTION_GROUPS = 17


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def scrubbed_environment(home: Path) -> dict[str, str]:
    """Pass only launcher-safe variables; never inherit provider/database credentials."""
    return {
        "PATH": f"{PG_BIN}:{os.environ.get('PATH', '')}",
        "HOME": str(home),
        "USER": os.environ.get("USER", "ubuntu"),
        "LOGNAME": os.environ.get("LOGNAME", "ubuntu"),
        "LC_ALL": "C",
        "LANG": "C",
    }


def allocate_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def run_local(command: list[str], *, env: dict[str, str], timeout: int) -> None:
    result = subprocess.run(
        command,
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"local PG17 command failed ({command[0]}): {result.stderr.strip() or result.stdout.strip()}"
        )


def wait_for_local_database(port: int, deadline_seconds: float) -> psycopg.Connection:
    deadline = time.monotonic() + deadline_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            connection = psycopg.connect(
                host="127.0.0.1",
                port=port,
                dbname="postgres",
                user="postgres",
                connect_timeout=2,
                autocommit=True,
            )
            connection.execute("SET statement_timeout = '15s'")
            connection.execute("SET lock_timeout = '5s'")
            return connection
        except psycopg.OperationalError as error:
            last_error = error
            time.sleep(0.15)
    raise RuntimeError(f"isolated PG17 did not accept loopback connections: {last_error}")


def bootstrap_legacy_catalog(connection: psycopg.Connection) -> None:
    """Build the audited UUID-era shape/policy/privilege matrix with synthetic values only."""
    connection.execute(
        """
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE circles_app_runtime NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;

        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid
          LANGUAGE sql STABLE
          AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        GRANT USAGE ON SCHEMA auth TO authenticated;
        GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

        CREATE SCHEMA private;
        CREATE FUNCTION private.are_blocked(uuid, uuid) RETURNS boolean
          LANGUAGE sql STABLE
          AS $$ SELECT false $$;
        GRANT USAGE ON SCHEMA private TO authenticated;
        GRANT EXECUTE ON FUNCTION private.are_blocked(uuid, uuid) TO authenticated;

        CREATE TABLE public.profiles (
          id uuid PRIMARY KEY,
          handle text NOT NULL,
          display_name text NOT NULL,
          avatar_url text,
          bio text NOT NULL,
          interests text[] NOT NULL,
          created_at timestamp with time zone NOT NULL,
          onboarding_completed_at timestamp with time zone
        );
        CREATE TABLE public.circles (
          id uuid PRIMARY KEY,
          owner_id uuid,
          name text NOT NULL,
          description text NOT NULL,
          interest text NOT NULL,
          is_private boolean NOT NULL,
          members_count integer NOT NULL,
          cover_url text,
          cover_color text NOT NULL,
          created_at timestamp with time zone NOT NULL,
          welcome_text text NOT NULL,
          last_activity_at timestamp with time zone NOT NULL,
          rules text NOT NULL
        );
        CREATE TABLE public.follows (
          follower_id uuid NOT NULL,
          followee_id uuid NOT NULL,
          created_at timestamp with time zone NOT NULL,
          PRIMARY KEY (follower_id, followee_id)
        );
        ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.circles ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

        GRANT SELECT ON public.profiles, public.circles TO authenticated;
        GRANT SELECT, DELETE ON public.follows TO authenticated;
        GRANT ALL PRIVILEGES ON public.profiles, public.circles, public.follows TO service_role;

        CREATE POLICY "Circle owners update their circles"
          ON public.circles FOR UPDATE TO authenticated
          USING (owner_id = (SELECT auth.uid()))
          WITH CHECK (owner_id = (SELECT auth.uid()));
        CREATE POLICY "Signed in members can discover circle listings"
          ON public.circles FOR SELECT TO authenticated USING (true);
        CREATE POLICY "Signed in members create circles for themselves"
          ON public.circles FOR INSERT TO authenticated
          WITH CHECK (owner_id = (SELECT auth.uid()));

        CREATE POLICY "Members delete permitted follows"
          ON public.follows FOR DELETE TO authenticated
          USING (
            (follower_id = (SELECT auth.uid()))
            OR (
              (followee_id = (SELECT auth.uid()))
              AND private.are_blocked((SELECT auth.uid()), follower_id)
            )
          );
        CREATE POLICY "Members insert their own follows"
          ON public.follows FOR INSERT TO authenticated
          WITH CHECK (
            (follower_id = (SELECT auth.uid()))
            AND (NOT private.are_blocked((SELECT auth.uid()), followee_id))
          );
        CREATE POLICY "Members see follows"
          ON public.follows FOR SELECT TO authenticated USING (true);

        CREATE POLICY "Members update their own profile"
          ON public.profiles FOR UPDATE TO authenticated
          USING (id = (SELECT auth.uid()))
          WITH CHECK (id = (SELECT auth.uid()));
        CREATE POLICY "Profiles are visible to signed in members"
          ON public.profiles FOR SELECT TO authenticated USING (true);
        """
    )
    connection.execute(
        """
        INSERT INTO public.profiles (
          id, handle, display_name, bio, interests, created_at, onboarding_completed_at
        ) VALUES
          (%s, 'alpha', 'Synthetic Alpha', 'fixture', ARRAY['fixture']::text[], now(), now()),
          (%s, 'bravo', 'Synthetic Bravo', 'fixture', ARRAY['fixture']::text[], now(), now()),
          (%s, 'charlie', 'Synthetic Charlie', 'fixture', ARRAY['fixture']::text[], now(), now())
        """,
        (OWNER_A, OWNER_B, VIEWER_C),
    )
    connection.execute(
        """
        INSERT INTO public.circles (
          id, owner_id, name, description, interest, is_private, members_count, cover_color,
          created_at, welcome_text, last_activity_at, rules
        ) VALUES
          ('10000000-0000-0000-0000-000000000001', %s, 'public', 'fixture', 'fixture', false, 1, '#000000', now(), 'fixture', now(), 'fixture'),
          ('10000000-0000-0000-0000-000000000002', %s, 'private-a', 'fixture', 'fixture', true, 1, '#000000', now(), 'fixture', now(), 'fixture'),
          ('10000000-0000-0000-0000-000000000003', %s, 'private-b', 'fixture', 'fixture', true, 1, '#000000', now(), 'fixture', now(), 'fixture')
        """,
        (OWNER_A, OWNER_A, OWNER_B),
    )
    connection.execute(
        """
        INSERT INTO public.follows (follower_id, followee_id, created_at) VALUES
          (%s, %s, now()), (%s, %s, now()), (%s, %s, now())
        """,
        (OWNER_A, OWNER_B, OWNER_B, OWNER_A, VIEWER_C, OWNER_A),
    )


def set_session_value(connection: psycopg.Connection, key: str, value: str) -> None:
    connection.execute("SELECT set_config(%s, %s, false)", (key, value))


def expect_failure(
    connection: psycopg.Connection,
    operation: Callable[[], None],
    expected_text: str,
) -> None:
    try:
        operation()
    except Exception as error:  # PostgreSQL syntax/RLS exception class varies by server build.
        connection.rollback()
        require(expected_text in str(error), f"expected {expected_text!r}, got {error!s}")
        return
    raise AssertionError(f"operation unexpectedly succeeded; expected {expected_text!r}")


def execute_candidate(
    connection: psycopg.Connection,
    script: str,
    settings: Iterable[tuple[str, str]] = (),
) -> None:
    for key, value in settings:
        set_session_value(connection, key, value)
    connection.execute(script)


def rows_as_authenticated(
    connection: psycopg.Connection,
    subject: str,
    query: str,
) -> list[tuple]:
    connection.execute("BEGIN")
    try:
        connection.execute("SET LOCAL ROLE authenticated")
        actual_role = connection.execute("SELECT current_user").fetchone()[0]
        require(actual_role == "authenticated", "RLS query did not run as authenticated")
        connection.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (subject,))
        result = connection.execute(query).fetchall()
    finally:
        connection.execute("ROLLBACK")
    return result


def expect_role_select_denied(
    connection: psycopg.Connection,
    role: str,
    table: str,
) -> None:
    connection.execute("BEGIN")
    try:
        connection.execute(f"SET LOCAL ROLE {role}")
        connection.execute(f"SELECT 1 FROM public.{table} LIMIT 1")
    except errors.InsufficientPrivilege:
        connection.rollback()
        return
    except Exception:
        connection.rollback()
        raise
    connection.rollback()
    raise AssertionError(f"{role} unexpectedly selected public.{table}")


def legacy_circle_names(connection: psycopg.Connection, subject: str) -> list[str]:
    return [
        row[0]
        for row in rows_as_authenticated(
            connection,
            subject,
            "SELECT name FROM public.circles ORDER BY name",
        )
    ]


def legacy_profile_ids(connection: psycopg.Connection, subject: str) -> list[str]:
    return [
        row[0]
        for row in rows_as_authenticated(
            connection,
            subject,
            "SELECT id::text FROM public.profiles ORDER BY id",
        )
    ]


def legacy_follow_edges(connection: psycopg.Connection, subject: str) -> list[str]:
    return [
        row[0]
        for row in rows_as_authenticated(
            connection,
            subject,
            "SELECT follower_id::text || '>' || followee_id::text FROM public.follows ORDER BY 1",
        )
    ]


def run() -> None:
    forward_sql = FORWARD_SQL.read_text(encoding="utf-8")
    rollback_sql = ROLLBACK_SQL.read_text(encoding="utf-8")
    require("PLACEHOLDER" not in forward_sql + rollback_sql, "unresolved DB-01 fingerprint marker")
    require(INITDB.is_file() and PG_CTL.is_file(), "PostgreSQL 17 binaries are required")

    temp_root = Path(tempfile.mkdtemp(prefix="circles-db01-pg17-"))
    data_dir = temp_root / "data"
    socket_dir = temp_root / "socket"
    socket_dir.mkdir()
    port = allocate_loopback_port()
    env = scrubbed_environment(temp_root)
    connection: psycopg.Connection | None = None
    cluster_started = False
    cleanup_error: Exception | None = None

    try:
        run_local(
            [
                str(INITDB),
                "-D",
                str(data_dir),
                "-U",
                "postgres",
                "--encoding=UTF8",
                "--auth-local=trust",
                "--auth-host=trust",
                "--no-instructions",
            ],
            env=env,
            timeout=25,
        )
        run_local(
            [
                str(PG_CTL),
                "-D",
                str(data_dir),
                "-l",
                str(data_dir / "postgres.log"),
                "-o",
                f"-c listen_addresses='127.0.0.1' -p {port} -k '{socket_dir}'",
                "start",
            ],
            env=env,
            timeout=10,
        )
        cluster_started = True
        connection = wait_for_local_database(port, deadline_seconds=20)
        server_version = int(connection.execute("SHOW server_version_num").fetchone()[0])
        require(170000 <= server_version < 180000, f"expected PG17, got {server_version}")
        listen_addresses = connection.execute("SHOW listen_addresses").fetchone()[0]
        require(
            listen_addresses in {"127.0.0.1", "localhost"},
            f"fixture must bind only to loopback, got {listen_addresses!r}",
        )
        bootstrap_legacy_catalog(connection)

        # Inactive by default: lack of owner/compatibility approval cannot alter the broad policy.
        expect_failure(
            connection,
            lambda: execute_candidate(connection, forward_sql),
            "requires explicit owner and compatibility approval",
        )
        require(legacy_circle_names(connection, VIEWER_C) == ["private-a", "private-b", "public"], "unapproved candidate changed circles")
        require(len(legacy_profile_ids(connection, VIEWER_C)) == 3, "unapproved candidate changed profiles")
        require(len(legacy_follow_edges(connection, VIEWER_C)) == 3, "unapproved candidate changed follows")

        # A contract value without the explicit acknowledgement is separately refused.
        expect_failure(
            connection,
            lambda: execute_candidate(
                connection,
                forward_sql,
                [("circles.db01_legacy_public_privacy_contract", FORWARD_CONTRACT)],
            ),
            "requires explicit owner/compatibility-loss acknowledgment",
        )

        execute_candidate(
            connection,
            forward_sql,
            [
                ("circles.db01_legacy_public_privacy_contract", FORWARD_CONTRACT),
                ("circles.db01_legacy_public_privacy_acknowledgment", FORWARD_ACK),
            ],
        )

        # Native PostgreSQL role/RLS behavior: owner/non-owner/public/private/profile/follow edges.
        require(legacy_circle_names(connection, OWNER_A) == ["private-a", "public"], "owner private-circle read failed")
        require(legacy_circle_names(connection, OWNER_B) == ["private-b", "public"], "non-owner private-circle boundary failed")
        require(legacy_circle_names(connection, VIEWER_C) == ["public"], "public/private circle visibility failed")
        require(legacy_profile_ids(connection, OWNER_A) == [OWNER_A], "own-profile boundary failed")
        require(legacy_profile_ids(connection, OWNER_B) == [OWNER_B], "cross-profile boundary failed")
        require(legacy_follow_edges(connection, OWNER_A) == [f"{OWNER_A}>{OWNER_B}"], "outgoing follow boundary failed")
        require(legacy_follow_edges(connection, OWNER_B) == [f"{OWNER_B}>{OWNER_A}"], "followee/third-party follow boundary failed")
        require(legacy_follow_edges(connection, VIEWER_C) == [f"{VIEWER_C}>{OWNER_A}"], "third synthetic subject follow boundary failed")
        for role in ("anon", "circles_app_runtime"):
            for table in ("circles", "profiles", "follows"):
                expect_role_select_denied(connection, role, table)

        # Safe rollback has its own acknowledgement and restores only the exact V1 narrow state.
        expect_failure(
            connection,
            lambda: execute_candidate(connection, rollback_sql),
            "rollback requires explicit incident/owner approval",
        )
        expect_failure(
            connection,
            lambda: execute_candidate(
                connection,
                rollback_sql,
                [("circles.db01_legacy_public_privacy_rollback_contract", ROLLBACK_CONTRACT)],
            ),
            "rollback requires explicit compatibility-restoration acknowledgment",
        )
        execute_candidate(
            connection,
            rollback_sql,
            [
                ("circles.db01_legacy_public_privacy_rollback_contract", ROLLBACK_CONTRACT),
                ("circles.db01_legacy_public_privacy_rollback_acknowledgment", ROLLBACK_ACK),
            ],
        )
        require(legacy_circle_names(connection, VIEWER_C) == ["private-a", "private-b", "public"], "rollback did not restore broad circle compatibility")
        require(len(legacy_profile_ids(connection, VIEWER_C)) == 3, "rollback did not restore broad profile compatibility")
        require(len(legacy_follow_edges(connection, VIEWER_C)) == 3, "rollback did not restore broad follow compatibility")

        # Change an unrelated target-table policy while keeping the broad SELECT policies intact:
        # the row-free full inventory pin must refuse the candidate before ALTER POLICY can run.
        connection.execute(
            '''ALTER POLICY "Circle owners update their circles" ON public.circles
               USING (false) WITH CHECK (false)'''
        )
        expect_failure(
            connection,
            lambda: execute_candidate(
                connection,
                forward_sql,
                [
                    ("circles.db01_legacy_public_privacy_contract", FORWARD_CONTRACT),
                    ("circles.db01_legacy_public_privacy_acknowledgment", FORWARD_ACK),
                ],
            ),
            "strict current-catalog fingerprint drift",
        )
        connection.execute(
            '''ALTER POLICY "Circle owners update their circles" ON public.circles
               USING (owner_id = (SELECT auth.uid()))
               WITH CHECK (owner_id = (SELECT auth.uid()))'''
        )

    finally:
        if connection is not None:
            connection.close()
        if cluster_started:
            try:
                run_local(
                    [str(PG_CTL), "-D", str(data_dir), "-m", "immediate", "-w", "-t", "20", "stop"],
                    env=env,
                    timeout=30,
                )
            except Exception as error:  # Preserve cleanup failure rather than hiding it.
                cleanup_error = error
        try:
            shutil.rmtree(temp_root)
        except Exception as error:
            cleanup_error = cleanup_error or error
        if cleanup_error is not None:
            raise RuntimeError(f"DB-01 fixture cleanup failed: {cleanup_error}") from cleanup_error

    print(f"DB-01 PG17 proof passed: {ASSERTION_GROUPS} assertion groups; synthetic roles=4; cleanup=removed")


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        print(f"DB-01 PG17 proof failed: {error}", file=sys.stderr)
        raise
