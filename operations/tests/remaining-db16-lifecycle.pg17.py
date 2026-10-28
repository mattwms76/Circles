#!/usr/bin/env python3
"""Disposable PostgreSQL 17 proof for the DB-16 lifecycle candidates.

Run only from the repository root:
  env -i PATH=/usr/bin:/bin HOME=/tmp CI=1 /usr/bin/python3 -B \
    operations/tests/remaining-db16-lifecycle.pg17.py --local-pg17

The script accepts no DSN, does not load .env, and creates one temporary,
loopback-only PostgreSQL cluster with synthetic hashes. It first proves that
the installed policy is inactive, then performs an explicit, temporary
synthetic-only policy transition inside that disposable cluster. The latter
exists solely to exercise the real helper's p_dry_run => false path; it is not
an owner approval, production activation, schedule request, or reusable
approval artifact. No schedule is created.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, NoReturn

import psycopg
from psycopg.rows import dict_row

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PG_BIN = Path(os.environ.get("POSTGRES17_BIN", "/usr/lib/postgresql/17/bin"))
CANDIDATE_SQL = PROJECT_ROOT / "operations/remediation/remaining_db16_security_state_lifecycle.sql"
ACTIVATION_SCHEDULE_CANDIDATE_SQL = (
    PROJECT_ROOT
    / "operations/remediation/remaining_db16_security_state_retention_activation_schedule.sql"
)

# These values only satisfy the active-row shape inside this process's fresh,
# deleted-on-exit local cluster. They are intentionally explicit that they are
# not owner approvals and are never emitted as test output or audit data.
SYNTHETIC_CONSTRAINT_REFERENCE = (
    "temporary local PG17 constraint value; explicitly not an owner approval"
)
SYNTHETIC_CONFIRMATION = {
    "destructive_proof_scope": "ephemeral-loopback-pg17-only",
    "synthetic_test_only": True,
}


def fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def local_environment(home: Path) -> dict[str, str]:
    """Do not pass inherited DSNs, provider credentials, or proxy settings."""
    return {
        "PATH": f"{PG_BIN}:/usr/bin:/bin",
        "HOME": str(home),
        "CI": "1",
        "LC_ALL": "C",
    }


def checked(arguments: list[str], environment: dict[str, str], timeout: int = 60) -> None:
    result = subprocess.run(
        arguments,
        cwd=PROJECT_ROOT,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
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
    fail("unable to reserve a loopback synthetic-test port")


def connect(port: int) -> psycopg.Connection[dict[str, Any]]:
    return psycopg.connect(
        host="127.0.0.1",
        port=port,
        dbname="postgres",
        user="postgres",
        connect_timeout=5,
        row_factory=dict_row,
    )


def expect_error(operation: Callable[[], Any], fragment: str) -> None:
    try:
        operation()
    except psycopg.Error as error:
        if fragment not in str(error):
            fail(f"expected guarded refusal {fragment!r}")
    else:
        fail("expected guarded local SQL refusal")


def setup_baseline(connection: psycopg.Connection[dict[str, Any]]) -> None:
    connection.execute(
        """
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN;
        CREATE ROLE circles_app_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
        CREATE ROLE circles_app_login NOLOGIN NOINHERIT NOBYPASSRLS;
        CREATE ROLE circles_admin_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
        CREATE ROLE circles_admin_native_executor NOLOGIN NOINHERIT NOBYPASSRLS;

        CREATE SCHEMA circles_ops AUTHORIZATION postgres;
        CREATE SCHEMA circles_auth AUTHORIZATION postgres;
        CREATE SCHEMA circles_app AUTHORIZATION postgres;
        -- This plain relation deliberately supplies only the existing Cron 7
        -- sentinel. The separate activation candidate must refuse it because
        -- the real pg_cron extension/API is absent.
        CREATE SCHEMA cron AUTHORIZATION postgres;
        CREATE TABLE cron.job (
          jobid bigint PRIMARY KEY,
          jobname text NOT NULL,
          schedule text NOT NULL,
          command text NOT NULL,
          database text NOT NULL,
          username name NOT NULL,
          active boolean NOT NULL
        );
        INSERT INTO cron.job(jobid, jobname, schedule, command, database, username, active)
          VALUES (7, 'circles-app-daily-migration-health', '15 3 * * *', 'SELECT circles_ops.run_daily_migration_health()', 'postgres', 'postgres', true);

        CREATE TABLE circles_app."applicationSessions" (
          "sessionFingerprint" varchar(64) PRIMARY KEY,
          "userOpenId" varchar(64) NOT NULL,
          "appId" varchar(128) NOT NULL,
          "expiresAt" timestamptz NOT NULL,
          "revokedAt" timestamptz,
          "createdAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX application_sessions_expiry_idx
          ON circles_app."applicationSessions" ("expiresAt");
        ALTER TABLE circles_app."applicationSessions" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE circles_app."applicationSessions" FORCE ROW LEVEL SECURITY;
        CREATE POLICY runtime_application_sessions_policy
          ON circles_app."applicationSessions" FOR ALL TO circles_app_runtime
          USING (true) WITH CHECK (true);

        CREATE TABLE circles_auth.oauth_pending_states (
          state_fingerprint text PRIMARY KEY,
          flow_kind text NOT NULL,
          cookie_binding_fingerprint text,
          flow_token_fingerprint text,
          redirect_uri text NOT NULL,
          nonce text NOT NULL,
          frontend_origin text,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp()
        );
        CREATE INDEX circles_auth_oauth_pending_states_expires_at_idx
          ON circles_auth.oauth_pending_states (expires_at);
        ALTER TABLE circles_auth.oauth_pending_states ENABLE ROW LEVEL SECURITY;
        ALTER TABLE circles_auth.oauth_pending_states FORCE ROW LEVEL SECURITY;
        CREATE POLICY circles_auth_oauth_pending_states_runtime_backend_policy
          ON circles_auth.oauth_pending_states FOR ALL TO circles_app_runtime
          USING (true) WITH CHECK (true);
        """
    )
    connection.commit()


def fingerprint(label: str) -> str:
    """Synthetic deterministic 64-character value; never a user or OAuth secret."""
    encoded = label.encode("ascii").hex()
    return (encoded + ("0" * 64))[:64]


def insert_oauth(
    connection: psycopg.Connection[dict[str, Any]], label: str, expires_at: datetime
) -> str:
    key = fingerprint(label)
    connection.execute(
        """
        INSERT INTO circles_auth.oauth_pending_states (
          state_fingerprint, flow_kind, cookie_binding_fingerprint,
          flow_token_fingerprint, redirect_uri, nonce, frontend_origin,
          expires_at, created_at
        ) VALUES (%s, 'web', %s, NULL, 'https://synthetic.invalid/oauth',
                  'abcdefghijklmnopqrstuvwxyzABCDEF', 'https://synthetic.invalid',
                  %s, %s)
        """,
        (key, fingerprint(f"cookie-{label}"), expires_at, expires_at - timedelta(minutes=10)),
    )
    return key


def insert_session(
    connection: psycopg.Connection[dict[str, Any]],
    label: str,
    expires_at: datetime,
    revoked_at: datetime | None,
) -> str:
    key = fingerprint(label)
    connection.execute(
        """
        INSERT INTO circles_app."applicationSessions" (
          "sessionFingerprint", "userOpenId", "appId", "expiresAt", "revokedAt", "createdAt"
        ) VALUES (%s, 'synthetic-open-id', 'circles-synthetic', %s, %s, %s)
        """,
        (key, expires_at, revoked_at, expires_at - timedelta(days=1)),
    )
    return key


def lifecycle_run(
    connection: psycopg.Connection[dict[str, Any]],
    *,
    dry_run: bool,
    batch_size: int = 25,
    execution_source: str = "manual",
    confirmation: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT state_kind, candidate_count, deleted_count, hold_active
        FROM circles_ops.run_remaining_db16_security_state_retention(
          p_dry_run => %s,
          p_batch_size => %s,
          p_execution_source => %s,
          p_confirmation => %s::jsonb
        )
        ORDER BY state_kind
        """,
        (
            dry_run,
            batch_size,
            execution_source,
            None if confirmation is None else json.dumps(confirmation, sort_keys=True),
        ),
    ).fetchall()
    if len(rows) != 2:
        fail("lifecycle helper did not return exactly two aggregate state rows")
    return rows


def row_for(rows: list[dict[str, Any]], state_kind: str) -> dict[str, Any]:
    for row in rows:
        if row["state_kind"] == state_kind:
            return row
    fail(f"missing aggregate state row {state_kind}")


def assert_result(
    rows: list[dict[str, Any]],
    *,
    oauth_candidates: int,
    oauth_deleted: int,
    oauth_hold: bool,
    session_candidates: int,
    session_deleted: int,
    session_hold: bool,
) -> None:
    oauth = row_for(rows, "expired_oauth_pending_states")
    sessions = row_for(rows, "expired_or_long_revoked_application_sessions")
    if oauth != {
        "state_kind": "expired_oauth_pending_states",
        "candidate_count": oauth_candidates,
        "deleted_count": oauth_deleted,
        "hold_active": oauth_hold,
    } or sessions != {
        "state_kind": "expired_or_long_revoked_application_sessions",
        "candidate_count": session_candidates,
        "deleted_count": session_deleted,
        "hold_active": session_hold,
    }:
        fail("unexpected aggregate lifecycle result")


def oauth_existing(connection: psycopg.Connection[dict[str, Any]], keys: list[str]) -> int:
    row = connection.execute(
        """
        SELECT count(*)::integer AS count
        FROM circles_auth.oauth_pending_states
        WHERE state_fingerprint = ANY(%s::text[])
        """,
        (keys,),
    ).fetchone()
    if row is None:
        fail("unable to count synthetic OAuth state")
    return int(row["count"])


def sessions_existing(connection: psycopg.Connection[dict[str, Any]], keys: list[str]) -> int:
    row = connection.execute(
        """
        SELECT count(*)::integer AS count
        FROM circles_app."applicationSessions"
        WHERE "sessionFingerprint" = ANY(%s::text[])
        """,
        (keys,),
    ).fetchone()
    if row is None:
        fail("unable to count synthetic application session state")
    return int(row["count"])


def add_hold(connection: psycopg.Connection[dict[str, Any]], scope: str) -> None:
    connection.execute(
        """
        INSERT INTO circles_ops.remaining_db16_security_state_retention_holds (
          hold_scope, hold_reason, external_reference
        ) VALUES (%s, 'legal', 'temporary-loopback-pg17-hold')
        """,
        (scope,),
    )


def release_holds(connection: psycopg.Connection[dict[str, Any]]) -> None:
    connection.execute(
        """
        UPDATE circles_ops.remaining_db16_security_state_retention_holds
           SET released_at = pg_catalog.clock_timestamp()
         WHERE released_at IS NULL
        """
    )


def activate_synthetic_only(connection: psycopg.Connection[dict[str, Any]]) -> None:
    """Explicitly activate only the disposable policy row for destructive proof."""
    connection.execute(
        """
        UPDATE circles_ops.remaining_db16_security_state_retention_policy
           SET policy_version = 'synthetic-pg17-destructive-proof-only-v1',
               activation_state = 'active',
               destructive_deletion_enabled = true,
               schedule_enabled = false,
               schedule_cadence = NULL,
               owner_approval_reference = %s,
               destructive_confirmation = %s::jsonb,
               updated_at = pg_catalog.clock_timestamp()
         WHERE policy_id = true
        """,
        (SYNTHETIC_CONSTRAINT_REFERENCE, json.dumps(SYNTHETIC_CONFIRMATION, sort_keys=True)),
    )
    policy = connection.execute(
        """
        SELECT activation_state, destructive_deletion_enabled, schedule_enabled,
               schedule_cadence, owner_approval_reference, destructive_confirmation
        FROM circles_ops.remaining_db16_security_state_retention_policy
        WHERE policy_id = true
        """
    ).fetchone()
    if policy is None or policy["activation_state"] != "active" or policy[
        "destructive_deletion_enabled"
    ] is not True or policy["schedule_enabled"] is not False or policy[
        "schedule_cadence"
    ] is not None or policy["owner_approval_reference"] != SYNTHETIC_CONSTRAINT_REFERENCE or policy[
        "destructive_confirmation"
    ] != SYNTHETIC_CONFIRMATION:
        fail("explicit temporary synthetic policy activation did not retain its local-only shape")


def run() -> None:
    if sys.argv[1:] != ["--local-pg17"]:
        print("SKIP: pass --local-pg17 to run the disposable DB-16 lifecycle drill")
        return
    if not (PG_BIN / "initdb").is_file() or not (PG_BIN / "pg_ctl").is_file():
        fail("PostgreSQL 17 binaries are unavailable")

    temporary_directory = Path(tempfile.mkdtemp(prefix="circles-remaining-db16-pg17-"))
    data_directory = temporary_directory / "data"
    port = reserve_loopback_port()
    environment = local_environment(temporary_directory)
    server_started = False
    admin: psycopg.Connection[dict[str, Any]] | None = None
    locker: psycopg.Connection[dict[str, Any]] | None = None
    activation_probe: psycopg.Connection[dict[str, Any]] | None = None
    try:
        checked(
            [
                str(PG_BIN / "initdb"),
                "-D",
                str(data_directory),
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
        checked(
            [
                str(PG_BIN / "pg_ctl"),
                "-D",
                str(data_directory),
                "-l",
                str(temporary_directory / "postgres.log"),
                "-o",
                f"-h 127.0.0.1 -p {port} -k {temporary_directory}",
                "-w",
                "start",
            ],
            environment,
        )
        server_started = True
        admin = connect(port)
        setup_baseline(admin)
        admin.execute(CANDIDATE_SQL.read_text(encoding="utf-8"))
        admin.commit()
        admin.autocommit = True

        policy = admin.execute(
            """
            SELECT activation_state, destructive_deletion_enabled, schedule_enabled,
                   schedule_cadence, owner_approval_reference, destructive_confirmation
            FROM circles_ops.remaining_db16_security_state_retention_policy
            """
        ).fetchone()
        if policy != {
            "activation_state": "inactive",
            "destructive_deletion_enabled": False,
            "schedule_enabled": False,
            "schedule_cadence": None,
            "owner_approval_reference": None,
            "destructive_confirmation": None,
        }:
            fail("installation did not retain the exact inactive/no-schedule policy")

        # The schedule candidate must reject a cron lookalike rather than using
        # it. This exercises its installed-pg_cron guard without adding a job.
        activation_probe = connect(port)
        expect_error(
            lambda: activation_probe.execute(
                ACTIVATION_SCHEDULE_CANDIDATE_SQL.read_text(encoding="utf-8")
            ),
            "requires installed pg_cron with cron.schedule(text,text,text)",
        )
        activation_probe.rollback()
        activation_probe.close()
        activation_probe = None
        cron_before = admin.execute(
            "SELECT jobid, schedule, username::text AS username, active FROM cron.job ORDER BY jobid"
        ).fetchall()
        if cron_before != [
            {"jobid": 7, "schedule": "15 3 * * *", "username": "postgres", "active": True}
        ]:
            fail("guarded activation candidate changed Cron 7 while pg_cron was unavailable")
        print("PASS: inactive installation and the actual-pg_cron guard leave Cron 7 unchanged")

        now = datetime.now(timezone.utc)
        # Synthetic lifecycle boundaries: OAuth expiry, the 90-day normal
        # session horizon, the 180-day revoked branch, and a still-active
        # long-revoked session. The five-second margin avoids clock drift while
        # exercising each side of the exact interval predicate.
        boundary_oauth = insert_oauth(admin, "oauth-expired-boundary", now - timedelta(seconds=5))
        future_oauth = insert_oauth(admin, "oauth-future-boundary", now + timedelta(minutes=10))
        normal_90 = insert_session(
            admin, "session-expired-over-90", now - timedelta(days=90, seconds=5), None
        )
        under_90 = insert_session(
            admin, "session-expired-under-90", now - timedelta(days=89, hours=23, minutes=59, seconds=55), None
        )
        revoked_180 = insert_session(
            admin,
            "session-expired-revoked-over-180",
            now - timedelta(days=1),
            now - timedelta(days=180, seconds=5),
        )
        under_180 = insert_session(
            admin,
            "session-expired-revoked-under-180",
            now - timedelta(days=1),
            now - timedelta(days=179, hours=23, minutes=59, seconds=55),
        )
        active_long_revoked = insert_session(
            admin,
            "session-active-revoked-over-180",
            now + timedelta(days=5),
            now - timedelta(days=181),
        )
        source_identifiers = [
            boundary_oauth,
            future_oauth,
            normal_90,
            under_90,
            revoked_180,
            under_180,
            active_long_revoked,
        ]

        initial = lifecycle_run(admin, dry_run=True)
        assert_result(
            initial,
            oauth_candidates=1,
            oauth_deleted=0,
            oauth_hold=False,
            session_candidates=2,
            session_deleted=0,
            session_hold=False,
        )
        if oauth_existing(admin, [boundary_oauth, future_oauth]) != 2 or sessions_existing(
            admin, [normal_90, under_90, revoked_180, under_180, active_long_revoked]
        ) != 5:
            fail("dry-run lifecycle helper changed source rows")
        print("PASS: dry run honors OAuth expiry, 90-day session, 180-day revoked, and active-session boundaries")

        expect_error(
            lambda: lifecycle_run(
                admin,
                dry_run=False,
                batch_size=1,
                confirmation={},
            ),
            "destructive deletion is inactive",
        )
        expect_error(
            lambda: lifecycle_run(
                admin,
                dry_run=True,
                batch_size=1,
                execution_source="scheduled",
            ),
            "schedule invocation is not enabled",
        )
        print("PASS: inactive policy rejects deletion and scheduled invocation")

        # This direct UPDATE is deliberately limited to the new disposable
        # local database. It is neither a candidate activation run nor an owner
        # approval; it lets the test exercise the true helper deletion branch.
        activate_synthetic_only(admin)
        boundary_deleted = lifecycle_run(
            admin,
            dry_run=False,
            batch_size=25,
            confirmation=SYNTHETIC_CONFIRMATION,
        )
        assert_result(
            boundary_deleted,
            oauth_candidates=1,
            oauth_deleted=1,
            oauth_hold=False,
            session_candidates=2,
            session_deleted=2,
            session_hold=False,
        )
        if oauth_existing(admin, [boundary_oauth]) != 0 or oauth_existing(admin, [future_oauth]) != 1:
            fail("real helper deletion did not preserve OAuth expiry boundary")
        if sessions_existing(admin, [normal_90, revoked_180]) != 0 or sessions_existing(
            admin, [under_90, under_180, active_long_revoked]
        ) != 3:
            fail("real helper deletion did not preserve 90/180 or active-session boundaries")
        print("PASS: synthetic-only active deletion removes exactly expired OAuth and 90/180 eligible sessions; active sessions remain")

        # A broad all-scope hold must protect both state kinds during a real
        # p_dry_run => false invocation.
        all_oauth = insert_oauth(admin, "hold-all-oauth", now - timedelta(minutes=10))
        all_session = insert_session(admin, "hold-all-session", now - timedelta(days=100), None)
        source_identifiers.extend([all_oauth, all_session])
        add_hold(admin, "all")
        all_held = lifecycle_run(
            admin, dry_run=False, batch_size=25, confirmation=SYNTHETIC_CONFIRMATION
        )
        assert_result(
            all_held,
            oauth_candidates=0,
            oauth_deleted=0,
            oauth_hold=True,
            session_candidates=0,
            session_deleted=0,
            session_hold=True,
        )
        if oauth_existing(admin, [all_oauth]) != 1 or sessions_existing(admin, [all_session]) != 1:
            fail("all-scope hold did not protect synthetic source rows")
        release_holds(admin)

        # Each narrower scope must protect only its own relation; the opposite
        # relation is still actually deleted in the same helper invocation.
        oauth_scoped_oauth = insert_oauth(admin, "hold-oauth-oauth", now - timedelta(minutes=10))
        oauth_scoped_session = insert_session(
            admin, "hold-oauth-session", now - timedelta(days=100), None
        )
        source_identifiers.extend([oauth_scoped_oauth, oauth_scoped_session])
        add_hold(admin, "oauth_pending_states")
        oauth_held = lifecycle_run(
            admin, dry_run=False, batch_size=25, confirmation=SYNTHETIC_CONFIRMATION
        )
        assert_result(
            oauth_held,
            oauth_candidates=0,
            oauth_deleted=0,
            oauth_hold=True,
            session_candidates=2,
            session_deleted=2,
            session_hold=False,
        )
        if oauth_existing(admin, [all_oauth, oauth_scoped_oauth]) != 2 or sessions_existing(
            admin, [all_session, oauth_scoped_session]
        ) != 0:
            fail("OAuth-scope hold did not isolate its source relation")
        release_holds(admin)

        session_scoped_oauth = insert_oauth(admin, "hold-session-oauth", now - timedelta(minutes=10))
        session_scoped_session = insert_session(
            admin, "hold-session-session", now - timedelta(days=100), None
        )
        source_identifiers.extend([session_scoped_oauth, session_scoped_session])
        add_hold(admin, "application_sessions")
        session_held = lifecycle_run(
            admin, dry_run=False, batch_size=25, confirmation=SYNTHETIC_CONFIRMATION
        )
        assert_result(
            session_held,
            oauth_candidates=3,
            oauth_deleted=3,
            oauth_hold=False,
            session_candidates=0,
            session_deleted=0,
            session_hold=True,
        )
        if oauth_existing(admin, [all_oauth, oauth_scoped_oauth, session_scoped_oauth]) != 0 or sessions_existing(
            admin, [session_scoped_session]
        ) != 1:
            fail("application-session-scope hold did not isolate its source relation")
        release_holds(admin)
        held_cleanup = lifecycle_run(
            admin, dry_run=False, batch_size=25, confirmation=SYNTHETIC_CONFIRMATION
        )
        assert_result(
            held_cleanup,
            oauth_candidates=0,
            oauth_deleted=0,
            oauth_hold=False,
            session_candidates=1,
            session_deleted=1,
            session_hold=False,
        )
        print("PASS: real deletion respects all, OAuth-only, and application-session-only holds")

        # Lock one eligible source row of each kind in a second connection. The
        # helper must delete the unlocked companion rows and leave locked rows
        # for the next call instead of waiting or scanning around the bound.
        locked_oauth = insert_oauth(admin, "skip-locked-oauth", now - timedelta(minutes=10))
        available_oauth = insert_oauth(admin, "skip-available-oauth", now - timedelta(minutes=11))
        locked_session = insert_session(
            admin, "skip-locked-session", now - timedelta(days=100), None
        )
        available_session = insert_session(
            admin, "skip-available-session", now - timedelta(days=101), None
        )
        source_identifiers.extend([locked_oauth, available_oauth, locked_session, available_session])
        locker = connect(port)
        locker.execute("BEGIN")
        locker.execute(
            "SELECT state_fingerprint FROM circles_auth.oauth_pending_states WHERE state_fingerprint = %s FOR UPDATE",
            (locked_oauth,),
        )
        locker.execute(
            'SELECT "sessionFingerprint" FROM circles_app."applicationSessions" WHERE "sessionFingerprint" = %s FOR UPDATE',
            (locked_session,),
        )
        raced = lifecycle_run(
            admin, dry_run=False, batch_size=25, confirmation=SYNTHETIC_CONFIRMATION
        )
        assert_result(
            raced,
            oauth_candidates=1,
            oauth_deleted=1,
            oauth_hold=False,
            session_candidates=1,
            session_deleted=1,
            session_hold=False,
        )
        if oauth_existing(admin, [locked_oauth]) != 1 or oauth_existing(admin, [available_oauth]) != 0 or sessions_existing(
            admin, [locked_session]
        ) != 1 or sessions_existing(admin, [available_session]) != 0:
            fail("SKIP LOCKED destructive race did not retain only the locked rows")
        locker.execute("COMMIT")
        locker.close()
        locker = None
        skipped_cleanup = lifecycle_run(
            admin, dry_run=False, batch_size=25, confirmation=SYNTHETIC_CONFIRMATION
        )
        assert_result(
            skipped_cleanup,
            oauth_candidates=1,
            oauth_deleted=1,
            oauth_hold=False,
            session_candidates=1,
            session_deleted=1,
            session_hold=False,
        )
        print("PASS: real deletion uses SKIP LOCKED and deletes deferred locked rows only after release")

        # Actual deletion has both a default/max-25 proof and an independent
        # max-100 proof. The second run starts from one residual plus 100 new
        # rows, proving that 101 eligible rows leave exactly one untouched.
        batch_25_oauth = [
            insert_oauth(admin, f"batch25-oauth-{index:03d}", now - timedelta(minutes=20, seconds=index))
            for index in range(26)
        ]
        batch_25_sessions = [
            insert_session(
                admin,
                f"batch25-session-{index:03d}",
                now - timedelta(days=100, seconds=index),
                None,
            )
            for index in range(26)
        ]
        source_identifiers.extend(batch_25_oauth + batch_25_sessions)
        max_25 = lifecycle_run(
            admin, dry_run=False, batch_size=25, confirmation=SYNTHETIC_CONFIRMATION
        )
        assert_result(
            max_25,
            oauth_candidates=25,
            oauth_deleted=25,
            oauth_hold=False,
            session_candidates=25,
            session_deleted=25,
            session_hold=False,
        )
        if oauth_existing(admin, batch_25_oauth) != 1 or sessions_existing(admin, batch_25_sessions) != 1:
            fail("max-25 destructive deletion did not leave exactly one eligible row per kind")
        print("PASS: real deletion enforces max 25 per state kind")

        batch_100_oauth = [
            insert_oauth(admin, f"batch100-oauth-{index:03d}", now - timedelta(minutes=40, seconds=index))
            for index in range(100)
        ]
        batch_100_sessions = [
            insert_session(
                admin,
                f"batch100-session-{index:03d}",
                now - timedelta(days=120, seconds=index),
                None,
            )
            for index in range(100)
        ]
        source_identifiers.extend(batch_100_oauth + batch_100_sessions)
        max_100 = lifecycle_run(
            admin, dry_run=False, batch_size=100, confirmation=SYNTHETIC_CONFIRMATION
        )
        assert_result(
            max_100,
            oauth_candidates=100,
            oauth_deleted=100,
            oauth_hold=False,
            session_candidates=100,
            session_deleted=100,
            session_hold=False,
        )
        if oauth_existing(admin, batch_25_oauth + batch_100_oauth) != 1 or sessions_existing(
            admin, batch_25_sessions + batch_100_sessions
        ) != 1:
            fail("max-100 destructive deletion did not leave exactly one of 101 eligible rows per kind")
        expect_error(
            lambda: lifecycle_run(
                admin, dry_run=False, batch_size=101, confirmation=SYNTHETIC_CONFIRMATION
            ),
            "batch size 1 through 100",
        )
        final_batch_cleanup = lifecycle_run(
            admin, dry_run=False, batch_size=25, confirmation=SYNTHETIC_CONFIRMATION
        )
        assert_result(
            final_batch_cleanup,
            oauth_candidates=1,
            oauth_deleted=1,
            oauth_hold=False,
            session_candidates=1,
            session_deleted=1,
            session_hold=False,
        )
        print("PASS: real deletion enforces max 100 and rejects 101")

        audit_columns = {
            row["column_name"]
            for row in admin.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'circles_ops'
                  AND table_name = 'remaining_db16_security_state_retention_runs'
                ORDER BY ordinal_position
                """
            ).fetchall()
        }
        status_columns = {
            row["column_name"]
            for row in admin.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'circles_ops'
                  AND table_name = 'remaining_db16_security_state_retention_status'
                ORDER BY ordinal_position
                """
            ).fetchall()
        }
        forbidden_identifier_columns = {
            "state_fingerprint",
            "sessionFingerprint",
            "userOpenId",
            "appId",
            "owner_approval_reference",
            "destructive_confirmation",
        }
        if audit_columns & forbidden_identifier_columns or status_columns & forbidden_identifier_columns:
            fail("sanitized audit/status relation exposes a state identifier or approval payload")
        audit_row = admin.execute(
            """
            SELECT count(*)::integer AS count,
                   COALESCE(jsonb_agg(pg_catalog.to_jsonb(retention_run)), '[]'::jsonb)::text AS payload
            FROM circles_ops.remaining_db16_security_state_retention_runs AS retention_run
            """
        ).fetchone()
        status_row = admin.execute(
            """
            SELECT pg_catalog.to_jsonb(retention_status)::text AS payload
            FROM circles_ops.remaining_db16_security_state_retention_status AS retention_status
            """
        ).fetchone()
        if audit_row is None or status_row is None or audit_row["count"] < 11:
            fail("sanitized audit history did not record completed dry-run and real deletion invocations")
        audit_payload = audit_row["payload"]
        status_payload = status_row["payload"]
        if not isinstance(audit_payload, str) or not isinstance(status_payload, str):
            fail("sanitized audit/status payload was unavailable")
        if any(identifier in audit_payload or identifier in status_payload for identifier in source_identifiers):
            fail("sanitized audit/status payload leaked a synthetic source-row identifier")
        if SYNTHETIC_CONSTRAINT_REFERENCE in audit_payload or SYNTHETIC_CONSTRAINT_REFERENCE in status_payload:
            fail("sanitized audit/status payload leaked the synthetic constraint-only value")
        if "destructive_proof_scope" in audit_payload or "destructive_proof_scope" in status_payload:
            fail("sanitized audit/status payload leaked the synthetic confirmation object")
        if '"last_dry_run": false' not in status_payload or '"last_oauth_deleted_count": 1' not in status_payload:
            fail("sanitized status did not expose only the final aggregate real-deletion result")
        held_audit = admin.execute(
            """
            SELECT count(*)::integer AS count
            FROM circles_ops.remaining_db16_security_state_retention_runs
            WHERE oauth_hold_active OR session_hold_active
            """
        ).fetchone()
        if held_audit is None or held_audit["count"] < 3:
            fail("sanitized audit did not retain aggregate hold evidence")
        print("PASS: sanitized audit/status retain aggregates and hold results with no state identifiers or approval payloads")

        helper = admin.execute(
            """
            SELECT function_catalog.prosecdef AS security_definer,
                   owner_catalog.rolname AS owner,
                   pg_catalog.has_function_privilege('circles_app_runtime', function_catalog.oid, 'EXECUTE') AS runtime_execute
            FROM pg_catalog.pg_proc AS function_catalog
            JOIN pg_catalog.pg_namespace AS namespace_catalog
              ON namespace_catalog.oid = function_catalog.pronamespace
            JOIN pg_catalog.pg_roles AS owner_catalog ON owner_catalog.oid = function_catalog.proowner
            WHERE namespace_catalog.nspname = 'circles_ops'
              AND function_catalog.proname = 'run_remaining_db16_security_state_retention'
              AND function_catalog.pronargs = 4
            """
        ).fetchone()
        if helper != {"security_definer": True, "owner": "postgres", "runtime_execute": False}:
            fail("helper metadata does not retain the postgres-only execution boundary")
        # Prove the in-function session_user boundary too, then remove this
        # temporary grant before any final privilege assertion.
        admin.execute("GRANT USAGE ON SCHEMA circles_ops TO circles_app_runtime")
        admin.execute(
            "GRANT EXECUTE ON FUNCTION circles_ops.run_remaining_db16_security_state_retention(boolean, integer, text, jsonb) TO circles_app_runtime"
        )
        admin.execute("SET SESSION AUTHORIZATION circles_app_runtime")
        try:
            expect_error(
                lambda: lifecycle_run(admin, dry_run=True, batch_size=1),
                "executable only by postgres",
            )
        finally:
            admin.execute("RESET SESSION AUTHORIZATION")
            admin.execute(
                "REVOKE EXECUTE ON FUNCTION circles_ops.run_remaining_db16_security_state_retention(boolean, integer, text, jsonb) FROM circles_app_runtime"
            )
            admin.execute("REVOKE USAGE ON SCHEMA circles_ops FROM circles_app_runtime")
        runtime_denied = admin.execute(
            """
            SELECT pg_catalog.has_function_privilege(
              'circles_app_runtime',
              'circles_ops.run_remaining_db16_security_state_retention(boolean,integer,text,jsonb)',
              'EXECUTE'
            ) AS allowed
            """
        ).fetchone()
        if runtime_denied is None or runtime_denied["allowed"] is not False:
            fail("helper temporary privilege probe was not fully revoked")

        cron_rows = admin.execute(
            "SELECT jobid, schedule, username::text AS username, active FROM cron.job ORDER BY jobid"
        ).fetchall()
        if cron_rows != cron_before:
            fail("lifecycle drill changed existing Cron 7 or created a DB-16 schedule")
        print("PASS: helper privilege limits remain postgres-only and no synthetic run creates a schedule or changes Cron 7")
    finally:
        if activation_probe is not None:
            activation_probe.close()
        if locker is not None:
            locker.close()
        if admin is not None:
            admin.close()
        if server_started:
            try:
                checked(
                    [str(PG_BIN / "pg_ctl"), "-D", str(data_directory), "-m", "immediate", "-w", "stop"],
                    environment,
                )
            except Exception:
                fail("disposable PostgreSQL cleanup failed")
        shutil.rmtree(temporary_directory, ignore_errors=False)


if __name__ == "__main__":
    run()
