#!/usr/bin/env python3
"""Run the Circle Home HTTP E2E suite against a fresh loopback-only PG17 fixture.

This runner deliberately does not read, forward, or accept database URLs. Its child process
receives only an allowlisted environment and an ephemeral local PostgreSQL port.
"""
from __future__ import annotations

from argparse import ArgumentParser
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
from typing import NoReturn

import psycopg
from psycopg import sql


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PG_BIN = Path("/usr/lib/postgresql/17/bin")
NODE = Path(os.environ.get("npm_node_execpath") or shutil.which("node") or "/missing-node").resolve()
VITEST = PROJECT_ROOT / "node_modules/vitest/vitest.mjs"
FIXTURE_ENV_PORT = "CIRCLE_HOME_E2E_PG_PORT"
FIXTURE_DB = "circle_home_e2e_" + secrets.token_hex(12)
FIXTURE_TOKEN = secrets.token_hex(32)

BASELINE_AND_FEATURE_MIGRATIONS = (
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
)
ACTIVITY_MIGRATIONS = (
    "operations/migrations/0010_circles_activity_inbox.sql",
    "operations/migrations/0011_circles_ops_activity_health.sql",
)
SUITES = ("circle-home", "activity")


def fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def parse_suite(argv: list[str] | None = None) -> str:
    """Select one strict local fixture suite; arbitrary configs and DSNs are never accepted."""
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=SUITES, default="circle-home")
    return str(parser.parse_args(argv).suite)


def fixture_migrations(suite: str) -> tuple[str, ...]:
    """Return reviewed fixed migrations, requiring both Activity additions for that suite."""
    available_activity = tuple(
        relative_path
        for relative_path in ACTIVITY_MIGRATIONS
        if PROJECT_ROOT.joinpath(relative_path).is_file()
    )
    if suite == "activity" and available_activity != ACTIVITY_MIGRATIONS:
        fail("Activity E2E requires the reviewed 0010 and 0011 fixture migrations")
    # Circle Home keeps running during a concurrent additive migration rollout: it receives the
    # exact Activity schema/health pair together, never an orphan health definition that expects
    # tables not yet present. Activity mode above remains stricter and refuses a partial pair.
    return (
        BASELINE_AND_FEATURE_MIGRATIONS + ACTIVITY_MIGRATIONS
        if available_activity == ACTIVITY_MIGRATIONS
        else BASELINE_AND_FEATURE_MIGRATIONS
    )


def suite_config(suite: str) -> str:
    return (
        "e2e/activity.e2e.config.ts"
        if suite == "activity"
        else "e2e/circle-home.e2e.config.ts"
    )


def checked(argv: list[str], env: dict[str, str], *, timeout: int = 90) -> None:
    """Run local fixture tooling without echoing command output or environment values."""
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
        fail("local disposable PostgreSQL fixture command failed")


def reserve_loopback_port() -> int:
    """Choose a temporary loopback port while rejecting production/mobile defaults."""
    for _ in range(32):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = int(reservation.getsockname()[1])
        if port not in (3000, 8081):
            return port
    fail("unable to reserve an isolated loopback fixture port")


def fixture_environment(home: Path) -> dict[str, str]:
    """Return an explicit environment; inherited DSNs and credentials never cross this boundary."""
    return {
        "HOME": str(home),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PATH": f"{NODE.parent}:{PG_BIN}:/usr/bin:/bin",
        "NODE_ENV": "test",
        "CI": "1",
        "NO_COLOR": "1",
        "VITE_CONFIG_NATIVE_IGNORE_WARNING": "true",
    }


def apply_fixture_schema(
    port: int, *, suite: str, migrations: tuple[str, ...]
) -> None:
    """Apply private migrations and insert only synthetic records for one named suite."""
    with psycopg.connect(host="127.0.0.1", port=port, dbname="postgres", user="postgres", connect_timeout=5, autocommit=True) as bootstrap:
        bootstrap.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(FIXTURE_DB)))
    with psycopg.connect(
        host="127.0.0.1",
        port=port,
        dbname=FIXTURE_DB,
        user="postgres",
        connect_timeout=5,
        autocommit=True,
    ) as db:
        db.execute("CREATE SCHEMA e2e_fixture")
        db.execute("CREATE TABLE e2e_fixture.guard (token text PRIMARY KEY)")
        db.execute("INSERT INTO e2e_fixture.guard(token) VALUES (%s)", (FIXTURE_TOKEN,))
        for role in ("anon", "authenticated", "service_role"):
            db.execute(f"CREATE ROLE {role} NOLOGIN NOSUPERUSER NOBYPASSRLS")
        for relative_path in migrations:
            db.execute((PROJECT_ROOT / relative_path).read_text(encoding="utf-8"))

        # The current health function verifies the historical marker without reading application data.
        db.execute(
            """
            INSERT INTO circles_app."_dataMigrations"(key, "sourceTree", "completedAt", summary)
            VALUES (%s, %s, now(), '{}'::jsonb)
            """,
            (
                "circles-mysql-to-supabase-v1",
                "manifest-sha256:1196b25e66280952d905d860e3488fa82af9d082983c5315f28ead30b35172a7",
            ),
        )
        if "operations/migrations/0011_circles_ops_activity_health.sql" in migrations:
            # This catalog-only local health call proves the paired 25-table Activity extension
            # remains compatible with the longstanding Circle Home fixture before either suite
            # starts. It reads no application rows and writes only private local ops history.
            health = db.execute(
                "SELECT healthy, error_code FROM circles_ops.run_daily_migration_health()"
            ).fetchone()
            if health != (True, None):
                fail("paired Activity operations health contract is unhealthy")
        db.execute(
            """
            INSERT INTO circles_app.users(id, "openId", name)
            VALUES
              (1, 'circle-home-e2e-owner', 'Fixture owner'),
              (2, 'circle-home-e2e-moderator', 'Fixture moderator'),
              (3, 'circle-home-e2e-member', 'Fixture member'),
              (4, 'circle-home-e2e-pending', 'Fixture pending'),
              (5, 'circle-home-e2e-outsider', 'Fixture outsider'),
              (6, 'circle-home-e2e-author', 'Fixture author')
            """
        )
        db.execute(
            """
            INSERT INTO circles_app.profiles("userId", name, handle, bio, avatar)
            VALUES
              (1, 'Fixture owner', 'fixture-owner', '', ''),
              (2, 'Fixture moderator', 'fixture-moderator', '', ''),
              (3, 'Fixture member', 'fixture-member', '', ''),
              (4, 'Fixture pending', 'fixture-pending', '', ''),
              (5, 'Fixture outsider', 'fixture-outsider', '', ''),
              (6, 'Fixture author', 'fixture-author', '', '')
            """
        )
        db.execute(
            """
            INSERT INTO circles_app.circles(id, "ownerId", name, description, category, privacy)
            VALUES
              (11, 1, 'Public fixture', 'Public fixture circle', 'Art', 'public'),
              (12, 1, 'Private fixture', 'Private fixture circle', 'Art', 'private'),
              (13, 5, 'Foreign fixture', 'Foreign fixture circle', 'Art', 'public')
            """
        )
        db.execute(
            """
            INSERT INTO circles_app.memberships("circleId", "userId", role)
            VALUES
              (11, 1, 'owner'), (11, 2, 'moderator'), (11, 3, 'member'), (11, 4, 'pending'),
              (12, 1, 'owner'), (12, 3, 'member'), (12, 4, 'pending'),
              (13, 5, 'owner')
            """
        )
        if suite == "activity":
            # Activity target resolution requires current author membership for circle-scoped
            # posts. The default Circle Home fixture intentionally retains its original state.
            db.execute(
                """
                INSERT INTO circles_app.memberships("circleId", "userId", role)
                VALUES (11, 6, 'member'), (12, 6, 'member')
                """
            )
        db.execute(
            """
            INSERT INTO circles_app.posts(id, "authorId", "circleId", text)
            VALUES
              (101, 6, 11, 'Public fixture post'),
              (102, 6, 11, 'Same-circle fixture post'),
              (103, 6, 11, 'Replacement fixture post'),
              (104, 6, 13, 'Foreign fixture post'),
              (105, 6, 12, 'Private fixture post')
            """
        )
        # Explicit ids keep request assertions stable; future fixture writes remain safe too.
        membership_sequence_value = 10 if suite == "activity" else 8
        for sequence, value in (("users_id_seq", 6), ("profiles_id_seq", 6), ("circles_id_seq", 13), ("memberships_id_seq", membership_sequence_value), ("posts_id_seq", 105)):
            db.execute("SELECT setval(%s, %s, true)", (f"circles_app.{sequence}", value))


def main(argv: list[str] | None = None) -> int:
    suite = parse_suite(argv)
    migrations: tuple[str, ...] = ()
    evidence: dict[str, object] = {
        "suite": f"{suite}-isolated-http-e2e",
        "production_access": False,
        "production_write": False,
        "fixture": "fresh-local-postgresql-17",
        "passed": False,
    }
    phase = "preflight"
    temporary: Path | None = None
    started = False
    try:
        if not PROJECT_ROOT.joinpath("package.json").is_file():
            fail("Circle project root is unavailable")
        if not all(path.is_file() for path in (PG_BIN / "initdb", PG_BIN / "pg_ctl", NODE, VITEST)):
            fail("required pinned local E2E toolchain is unavailable")
        migrations = fixture_migrations(suite)
        probe_env = fixture_environment(PROJECT_ROOT)
        version = subprocess.run([str(NODE), "--version"], env=probe_env, capture_output=True, text=True, timeout=10, check=True)
        if version.stdout.strip() != "v22.23.4":
            fail("E2E requires the declared Node 22.23.4 runtime")
        pg_version = subprocess.run([str(PG_BIN / "initdb"), "--version"], env=probe_env, capture_output=True, text=True, timeout=10, check=True)
        if "(PostgreSQL) 17." not in pg_version.stdout:
            fail("E2E requires PostgreSQL major 17")

        temporary = Path(tempfile.mkdtemp(prefix="circles-circle-home-e2e-pg17-"))
        root = temporary
        root.chmod(0o700)
        env = fixture_environment(root)
        port = reserve_loopback_port()

        phase = "initdb"
        checked([str(PG_BIN / "initdb"), "-D", str(root / "data"), "-U", "postgres", "-A", "trust"], env)
        phase = "start-local-postgres"
        checked(
            [
                str(PG_BIN / "pg_ctl"),
                "-D",
                str(root / "data"),
                "-l",
                str(root / "postgres.log"),
                "-o",
                f"-h 127.0.0.1 -p {port} -k {root}",
                "-w",
                "start",
            ],
            env,
        )
        started = True
        phase = "migrate-and-seed"
        apply_fixture_schema(port, suite=suite, migrations=migrations)

        phase = "isolated-http-e2e"
        child_env = {**env, FIXTURE_ENV_PORT: str(port), "CIRCLE_HOME_E2E_DB": FIXTURE_DB, "CIRCLE_HOME_E2E_TOKEN": FIXTURE_TOKEN}
        result = subprocess.run(
            [
                str(NODE),
                str(VITEST),
                "run",
                "--config",
                suite_config(suite),
                "--reporter=default",
            ],
            cwd=PROJECT_ROOT,
            env=child_env,
            stdin=subprocess.DEVNULL,
            timeout=120,
            check=False,
        )
        if result.returncode:
            fail("isolated Circle Home HTTP E2E suite failed")
        evidence.update(
            {
                "passed": True,
                "postgres_major": 17,
                "migrations": len(migrations),
                "http": "loopback-only ephemeral port",
            }
        )
    except Exception as error:
        evidence.update({"failed_phase": phase, "error_category": type(error).__name__})
    finally:
        stopped = True
        if temporary is not None and (started or (temporary / "data/postmaster.pid").exists()):
            try:
                checked(
                    [str(PG_BIN / "pg_ctl"), "-D", str(temporary / "data"), "-m", "fast", "-w", "stop"],
                    fixture_environment(temporary),
                )
            except Exception:
                evidence["passed"] = False
                evidence["cleanup_error"] = "local_postgresql_stop_failed"
                try:
                    checked([str(PG_BIN / "pg_ctl"), "-D", str(temporary / "data"), "-m", "immediate", "-w", "stop"], fixture_environment(temporary))
                except Exception:
                    stopped = False
        if temporary is not None and stopped:
            try:
                shutil.rmtree(temporary)
                evidence["disposable_fixture_removed"] = not temporary.exists()
            except Exception:
                evidence["passed"] = False
                evidence["cleanup_error"] = "local_fixture_removal_failed"
        elif temporary is not None:
            evidence["disposable_fixture_removed"] = False
    print(json.dumps(evidence, sort_keys=True))
    return 0 if evidence["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
