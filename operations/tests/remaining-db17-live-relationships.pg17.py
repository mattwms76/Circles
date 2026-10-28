#!/usr/bin/env python3
"""DB-17 local PostgreSQL 17 rehearsal for the inactive live-FK candidate.

This accepts no DSN, target, credential, or command-line arguments. It runs only when
CIRCLES_DB17_LOCAL_PG17=1. A SHA-256-pinned, project-relative schema-only fixture supplies the
approved seven-table slice; a fresh local cluster adds synthetic rows, then is stopped and removed
in every outcome.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable

import psycopg


UNIT_ROOT = Path(__file__).resolve().parents[2]
CANDIDATE_SQL = UNIT_ROOT / "operations/remediation/remaining_db17_live_relationships.sql"
FIXTURE_RELATIVE_PATH = Path("operations/tests/fixtures/remaining-db17-schema.sql")
FIXTURE_SQL = (UNIT_ROOT / FIXTURE_RELATIVE_PATH).resolve()
FIXTURE_SHA256 = "05c26af00bcb539288a38f4713f798e6a6955f6632d24befefdb191667ec5a02"
PG_BIN = Path("/usr/lib/postgresql/17/bin")
INITDB = PG_BIN / "initdb"
PG_CTL = PG_BIN / "pg_ctl"
PSQL = PG_BIN / "psql"
POSTGRES = PG_BIN / "postgres"
APPROVAL_TOKEN = "DB17_LIVE_RELATIONSHIPS_ADOPTED_V1"
REQUIRED_TABLES = (
    "users",
    "circles",
    "streams",
    "activeHostLeases",
    "liveViewers",
    "liveSignals",
    "liveChat",
)
REQUIRED_ENUMS = ("user_role", "circle_privacy", "stream_status", "live_signal_kind")
PRIMARY_KEYS = {
    "users": "users_pkey",
    "circles": "circles_pkey",
    "streams": "streams_pkey",
    "activeHostLeases": "activeHostLeases_pkey",
    "liveViewers": "liveViewers_pkey",
    "liveSignals": "liveSignals_pkey",
    "liveChat": "liveChat_pkey",
}
EXPECTED_FKS = {
    "streams_host_id_db17_fkey": "r",
    "streams_circle_id_db17_fkey": "n",
    "active_host_leases_host_id_db17_fkey": "c",
    "active_host_leases_stream_id_db17_fkey": "n",
    "live_viewers_stream_id_db17_fkey": "r",
    "live_signals_stream_id_db17_fkey": "c",
    "live_chat_stream_id_db17_fkey": "r",
}
EXPECTED_NEW_INDEXES = {
    "streams_host_id_db17_fk_idx",
    "streams_circle_id_db17_fk_idx",
    "active_host_leases_stream_id_db17_fk_idx",
    "live_signals_stream_id_db17_fk_idx",
    "live_chat_stream_id_db17_fk_idx",
}


def quoted(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def table_reference(table: str) -> str:
    return f"circles_app.{quoted(table)}"


def clean_environment(root: Path, *, approved: bool) -> dict[str, str]:
    environment = {
        "PATH": "/usr/lib/postgresql/17/bin:/usr/bin:/bin",
        "HOME": str(root),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
    }
    if approved:
        environment["PGOPTIONS"] = f"-c circles.db17_live_relationships_contract={APPROVAL_TOKEN}"
    return environment


def run(command: Iterable[str | Path], environment: dict[str, str], *, timeout: int = 90) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(part) for part in command],
        check=False,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        env=environment,
        timeout=timeout,
    )


def checked(command: Iterable[str | Path], environment: dict[str, str], *, timeout: int = 90) -> subprocess.CompletedProcess[str]:
    result = run(command, environment, timeout=timeout)
    if result.returncode != 0:
        raise AssertionError(
            "command failed ({}):\n{}\n{}".format(
                " ".join(str(part) for part in command), result.stdout, result.stderr
            )
        )
    return result


def unused_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def table_token(table: str) -> str:
    return table if table in {"users", "circles", "streams"} else quoted(table)


class SyntheticPg17:
    def __init__(self, fixture_sql: str):
        self.fixture_sql = fixture_sql
        self.root = Path(tempfile.mkdtemp(prefix="circles-remaining-db17-pg17-"))
        self.root.chmod(0o700)
        self.port = unused_loopback_port()
        self.started = False
        self.cleaned = False

    @property
    def environment(self) -> dict[str, str]:
        return clean_environment(self.root, approved=False)

    def start(self) -> None:
        checked(
            [
                INITDB,
                "-D",
                self.root / "data",
                "-U",
                "postgres",
                "-A",
                "trust",
                "--no-locale",
                "--encoding=UTF8",
            ],
            self.environment,
        )
        checked(
            [
                PG_CTL,
                "-D",
                self.root / "data",
                "-l",
                self.root / "postgres.log",
                "-o",
                f"-h 127.0.0.1 -p {self.port} -k {self.root}",
                "-w",
                "start",
            ],
            self.environment,
        )
        self.started = True
        with self.connection() as connection:
            self.load_relevant_current_schema(connection)

    def connection(self) -> psycopg.Connection:
        return psycopg.connect(
            host="127.0.0.1",
            port=self.port,
            user="postgres",
            dbname="postgres",
            autocommit=True,
            connect_timeout=5,
        )

    def load_relevant_current_schema(self, connection: psycopg.Connection) -> None:
        connection.execute(self.fixture_sql)

        connection.execute("CREATE ROLE anon NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS")
        connection.execute("CREATE ROLE authenticated NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS")
        connection.execute("CREATE ROLE service_role NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS")
        connection.execute("CREATE ROLE circles_app_login NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS")
        connection.execute("CREATE ROLE circles_app_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS")
        connection.execute("CREATE ROLE circles_admin_runtime LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS")
        connection.execute("CREATE ROLE circles_admin_native_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS")
        connection.execute("GRANT circles_app_login TO postgres")

        for table in REQUIRED_TABLES:
            relation = table_reference(table)
            connection.execute(f"ALTER TABLE {relation} ENABLE ROW LEVEL SECURITY")
            connection.execute(f"ALTER TABLE {relation} FORCE ROW LEVEL SECURITY")
            connection.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {relation} TO circles_app_runtime")

        create_policies(connection)

    def candidate(self, *, approved: bool, acknowledgement: bool = True, single_transaction: bool = False) -> subprocess.CompletedProcess[str]:
        command: list[str | Path] = [
            PSQL,
            "-X",
            "-h",
            "127.0.0.1",
            "-p",
            str(self.port),
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
        ]
        if single_transaction:
            command.append("-1")
        if acknowledgement:
            command.extend(["-v", "db17_live_relationships_adopted_v1=1"])
        command.extend(["-f", CANDIDATE_SQL])
        return run(command, clean_environment(self.root, approved=approved), timeout=180)

    def close(self) -> None:
        cleanup_errors: list[str] = []
        if self.started:
            result = run(
                [PG_CTL, "-D", self.root / "data", "-m", "immediate", "-w", "stop"],
                self.environment,
                timeout=45,
            )
            if result.returncode != 0:
                cleanup_errors.append("local_postgresql_stop_failed")
        try:
            shutil.rmtree(self.root)
        except OSError as error:
            cleanup_errors.append(f"fixture_removal_failed:{error.__class__.__name__}")
        self.cleaned = not self.root.exists()
        if not self.cleaned:
            cleanup_errors.append("fixture_directory_still_exists")
        if cleanup_errors:
            raise AssertionError(",".join(cleanup_errors))


def create_policies(connection: psycopg.Connection) -> None:
    def policy(table: str, name: str, body: str) -> None:
        connection.execute(f"CREATE POLICY {quoted(name)} ON {table_reference(table)} {body}")

    for table, native_name, read_name, runtime_name in (
        ("activeHostLeases", "circles_admin_native_exec_activehostleases", "circles_admin_parity_read_activehostleases", "runtime_active_host_leases_policy"),
        ("streams", "circles_admin_native_exec_streams", "circles_admin_read_streams", "runtime_streams_policy"),
    ):
        policy(table, native_name, "FOR ALL TO circles_admin_native_executor USING (true) WITH CHECK (true)")
        policy(table, read_name, "FOR SELECT TO circles_admin_runtime USING (true)")
        policy(table, "circles_app_deny_anon_authenticated", "AS RESTRICTIVE FOR ALL TO authenticated, anon USING (false) WITH CHECK (false)")
        policy(table, runtime_name, "FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true)")

    policy("liveSignals", "circles_admin_native_exec_livesignals", "FOR ALL TO circles_admin_native_executor USING (true) WITH CHECK (true)")
    policy("liveSignals", "circles_app_deny_anon_authenticated", "AS RESTRICTIVE FOR ALL TO authenticated, anon USING (false) WITH CHECK (false)")
    policy("liveSignals", "runtime_live_signals_policy", "FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true)")

    policy("liveViewers", "circles_admin_read_liveviewers", "FOR SELECT TO circles_admin_runtime USING (true)")
    policy("liveViewers", "circles_app_deny_anon_authenticated", "AS RESTRICTIVE FOR ALL TO authenticated, anon USING (false) WITH CHECK (false)")
    policy("liveViewers", "runtime_live_viewers_policy", "FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true)")

    policy("liveChat", "circles_admin_parity_read_livechat", "FOR SELECT TO circles_admin_runtime USING (true)")
    policy("liveChat", "circles_app_deny_anon_authenticated", "AS RESTRICTIVE FOR ALL TO authenticated, anon USING (false) WITH CHECK (false)")
    policy("liveChat", "runtime_live_chat_policy", "FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true)")

    policy("users", "circles_admin_native_exec_users", "FOR ALL TO circles_admin_native_executor USING (true) WITH CHECK (true)")
    policy("users", "circles_admin_native_users_lock_only", "AS RESTRICTIVE FOR UPDATE TO circles_admin_native_executor USING (true) WITH CHECK (false)")
    policy("users", "circles_admin_read_users", "FOR SELECT TO circles_admin_runtime USING (true)")
    policy("users", "circles_app_deny_anon_authenticated", "AS RESTRICTIVE FOR ALL TO authenticated, anon USING (false) WITH CHECK (false)")
    policy("users", "runtime_users_policy", "FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true)")

    policy("circles", "circles_admin_native_exec_circles", "FOR ALL TO circles_admin_native_executor USING (true) WITH CHECK (true)")
    policy("circles", "circles_admin_read_circles", "FOR SELECT TO circles_admin_runtime USING (true)")
    policy("circles", "circles_app_deny_anon_authenticated", "AS RESTRICTIVE FOR ALL TO authenticated, anon USING (false) WITH CHECK (false)")
    policy("circles", "runtime_circles_policy", "FOR ALL TO circles_app_runtime USING (true) WITH CHECK (true)")


def seed_synthetic_rows(cluster: SyntheticPg17, *, orphan_history: bool = False) -> None:
    with cluster.connection() as connection:
        connection.execute(
            "INSERT INTO circles_app.users (id, \"openId\", name, email, \"loginMethod\", role) VALUES "
            "(1, 'synthetic-host-1', 'Synthetic Host', 'host1@example.invalid', 'synthetic', 'user'), "
            "(2, 'synthetic-viewer-2', 'Synthetic Viewer', 'viewer2@example.invalid', 'synthetic', 'user'), "
            "(3, 'synthetic-host-3', 'Synthetic Host 3', 'host3@example.invalid', 'synthetic', 'user'), "
            "(4, 'synthetic-lease-4', 'Synthetic Lease', 'lease4@example.invalid', 'synthetic', 'user')"
        )
        connection.execute(
            "INSERT INTO circles_app.circles "
            "(id, \"ownerId\", name, description, category, privacy, image, color, \"welcomeMessage\", rules) "
            "VALUES (10, 1, 'Synthetic Circle', 'Synthetic DB-17 fixture', 'testing', 'public', '', 'sage', '', '[]'::jsonb)"
        )
        connection.execute(
            "INSERT INTO circles_app.streams "
            "(id, \"hostId\", title, \"circleId\", thumbnail, status, \"hostGeneration\") "
            "VALUES (1, %s, 'Synthetic retained stream', 10, '', 'live', 1), "
            "(2, 3, 'Synthetic transient stream', NULL, '', 'live', 1)",
            (999 if orphan_history else 1,),
        )
        if orphan_history:
            return
        connection.execute(
            "INSERT INTO circles_app.\"activeHostLeases\" (\"hostId\", \"streamId\", \"lastHeartbeatAt\") "
            "VALUES (1, 1, clock_timestamp()), (3, 2, clock_timestamp()), (4, NULL, clock_timestamp())"
        )
        connection.execute(
            "INSERT INTO circles_app.\"liveViewers\" (\"streamId\", \"userId\", generation) VALUES (1, 2, 1)"
        )
        connection.execute(
            "INSERT INTO circles_app.\"liveSignals\" (id, \"streamId\", \"fromId\", \"toId\", kind, \"fromGeneration\", \"toGeneration\", payload) "
            "VALUES (1, 1, 1, 2, 'offer', 1, 1, 'synthetic-signal-one'), (2, 2, 3, NULL, 'offer', 1, 1, 'synthetic-signal-two')"
        )
        connection.execute(
            "INSERT INTO circles_app.\"liveChat\" (id, \"streamId\", \"userId\", \"userName\", avatar, text) "
            "VALUES (1, 1, 2, 'Synthetic Viewer', '', 'synthetic retained chat')"
        )


def output(result: subprocess.CompletedProcess[str]) -> str:
    return result.stdout + "\n" + result.stderr


def require_success(result: subprocess.CompletedProcess[str], label: str) -> None:
    if result.returncode != 0:
        raise AssertionError(f"{label} unexpectedly failed:\n{output(result)}")


def require_failure(result: subprocess.CompletedProcess[str], expected: str, label: str) -> None:
    if result.returncode == 0:
        raise AssertionError(f"{label} unexpectedly succeeded")
    if expected not in output(result):
        raise AssertionError(f"{label} did not include {expected!r}:\n{output(result)}")


def scalar(connection: psycopg.Connection, sql: str, parameters: tuple[object, ...] = ()) -> object:
    row = connection.execute(sql, parameters).fetchone()
    if row is None:
        raise AssertionError(f"query returned no row: {sql}")
    return row[0]


def expect_sqlstate(connection: psycopg.Connection, sql: str, code: str) -> None:
    try:
        connection.execute(sql)
    except psycopg.Error as error:
        if error.sqlstate != code:
            raise AssertionError(f"expected SQLSTATE {code}, got {error.sqlstate}: {error}") from error
    else:
        raise AssertionError(f"expected SQLSTATE {code} for {sql}")


def assert_exact_catalog(connection: psycopg.Connection) -> None:
    rows = connection.execute(
        "SELECT conname, confdeltype, convalidated FROM pg_catalog.pg_constraint "
        "WHERE conname = ANY(%s) ORDER BY conname",
        (list(EXPECTED_FKS),),
    ).fetchall()
    actual = {str(name): (str(delete_action), bool(validated)) for name, delete_action, validated in rows}
    expected = {name: (action, True) for name, action in EXPECTED_FKS.items()}
    if actual != expected:
        raise AssertionError(f"exact validated FK catalog mismatch: {actual!r}")
    indexes = {
        str(row[0])
        for row in connection.execute(
            "SELECT relation_catalog.relname FROM pg_catalog.pg_index AS index_catalog "
            "JOIN pg_catalog.pg_class AS relation_catalog ON relation_catalog.oid = index_catalog.indexrelid "
            "WHERE relation_catalog.relname = ANY(%s) "
            "AND index_catalog.indisvalid AND index_catalog.indisready AND index_catalog.indislive",
            (list(EXPECTED_NEW_INDEXES),),
        ).fetchall()
    }
    if indexes != EXPECTED_NEW_INDEXES:
        raise AssertionError(f"exact concurrent child-index catalog mismatch: {indexes!r}")


def close_cluster(cluster: SyntheticPg17, primary_error: BaseException | None) -> None:
    try:
        cluster.close()
    except BaseException:
        if primary_error is None:
            raise


def new_cluster(fixture_sql: str) -> SyntheticPg17:
    cluster = SyntheticPg17(fixture_sql)
    try:
        cluster.start()
        return cluster
    except BaseException as error:
        close_cluster(cluster, error)
        raise


def prove_inactive_gates(fixture_sql: str) -> None:
    cluster = new_cluster(fixture_sql)
    try:
        seed_synthetic_rows(cluster)
        require_failure(cluster.candidate(approved=False, acknowledgement=False), "DB-17 refused", "missing psql acknowledgement")
        require_failure(cluster.candidate(approved=False, acknowledgement=True), "require the exact session contract", "missing lifecycle session contract")
        with cluster.connection() as connection:
            count = scalar(connection, "SELECT count(*) FROM pg_catalog.pg_constraint WHERE conname = ANY(%s)", (list(EXPECTED_FKS),))
            if count != 0:
                raise AssertionError("inactive-gate failure installed a foreign key")
    except BaseException as error:
        close_cluster(cluster, error)
        raise
    else:
        close_cluster(cluster, None)


def prove_historical_orphan_refusal(fixture_sql: str) -> None:
    cluster = new_cluster(fixture_sql)
    try:
        seed_synthetic_rows(cluster, orphan_history=True)
        require_failure(cluster.candidate(approved=True), "historical orphan aggregate check failed", "invalid historical data refusal")
        with cluster.connection() as connection:
            count = scalar(connection, "SELECT count(*) FROM pg_catalog.pg_constraint WHERE conname = ANY(%s)", (list(EXPECTED_FKS),))
            if count != 0:
                raise AssertionError("orphan refusal installed a foreign key")
    except BaseException as error:
        close_cluster(cluster, error)
        raise
    else:
        close_cluster(cluster, None)


def prove_index_and_constraint_drift_refusal(fixture_sql: str) -> None:
    cluster = new_cluster(fixture_sql)
    try:
        seed_synthetic_rows(cluster)
        with cluster.connection() as connection:
            connection.execute('CREATE INDEX streams_host_id_db17_fk_idx ON circles_app.streams USING btree ("circleId")')
        require_failure(cluster.candidate(approved=True), "DB-17 index definition drift", "wrong child-index refusal")
    except BaseException as error:
        close_cluster(cluster, error)
        raise
    else:
        close_cluster(cluster, None)

    cluster = new_cluster(fixture_sql)
    try:
        seed_synthetic_rows(cluster)
        with cluster.connection() as connection:
            connection.execute(
                "ALTER TABLE circles_app.streams ADD CONSTRAINT streams_host_id_db17_fkey "
                "FOREIGN KEY (\"hostId\") REFERENCES circles_app.users(id) ON DELETE CASCADE"
            )
        require_failure(cluster.candidate(approved=True), "DB-17 live FK definition drift", "wrong FK refusal")
    except BaseException as error:
        close_cluster(cluster, error)
        raise
    else:
        close_cluster(cluster, None)


def prove_transaction_runner_refusal(fixture_sql: str) -> None:
    cluster = new_cluster(fixture_sql)
    try:
        seed_synthetic_rows(cluster)
        require_failure(
            cluster.candidate(approved=True, single_transaction=True),
            "CREATE INDEX CONCURRENTLY cannot run inside a transaction block",
            "transaction-wrapping runner refusal",
        )
    except BaseException as error:
        close_cluster(cluster, error)
        raise
    else:
        close_cluster(cluster, None)


def prove_all_actions_and_stream_end_preservation(fixture_sql: str) -> None:
    cluster = new_cluster(fixture_sql)
    try:
        seed_synthetic_rows(cluster)
        require_success(cluster.candidate(approved=True), "first approved synthetic candidate run")
        with cluster.connection() as connection:
            assert_exact_catalog(connection)

            # streams.hostId -> users RESTRICT: retained stream attribution blocks physical user deletion.
            expect_sqlstate(connection, "DELETE FROM circles_app.users WHERE id = 1", "23503")

            # streams.circleId -> circles SET NULL: the stream remains after Circle deletion.
            connection.execute("DELETE FROM circles_app.circles WHERE id = 10")
            if scalar(connection, "SELECT \"circleId\" IS NULL FROM circles_app.streams WHERE id = 1") is not True:
                raise AssertionError("Circle deletion did not detach the retained stream")

            # activeHostLeases.hostId -> users CASCADE: the only transient lease is removed.
            connection.execute("DELETE FROM circles_app.users WHERE id = 4")
            if scalar(connection, 'SELECT count(*) FROM circles_app."activeHostLeases" WHERE "hostId" = 4') != 0:
                raise AssertionError("user deletion did not cascade only the transient host lease")

            # activeHostLeases.streamId SET NULL and liveSignals CASCADE are exercised together on a stream
            # with neither retained viewer nor retained chat history.
            connection.execute("DELETE FROM circles_app.streams WHERE id = 2")
            if scalar(connection, 'SELECT "streamId" IS NULL FROM circles_app."activeHostLeases" WHERE "hostId" = 3') is not True:
                raise AssertionError("stream deletion did not clear transient host lease pointer")
            if scalar(connection, 'SELECT count(*) FROM circles_app."liveSignals" WHERE "streamId" = 2') != 0:
                raise AssertionError("stream deletion did not cascade transient signals")

            # The actual source-visible stream-end sequence changes lifecycle state, clears lease pointer,
            # and deletes signals, while retaining the stream/viewer/chat rows.
            connection.execute("UPDATE circles_app.streams SET status = 'ended', \"endedAt\" = clock_timestamp() WHERE id = 1")
            connection.execute('DELETE FROM circles_app."liveSignals" WHERE "streamId" = 1')
            connection.execute(
                'UPDATE circles_app."activeHostLeases" SET "streamId" = NULL, "lastHeartbeatAt" = NULL '
                'WHERE "hostId" = 1 AND "streamId" = 1'
            )
            if scalar(connection, "SELECT status::text = 'ended' AND \"endedAt\" IS NOT NULL FROM circles_app.streams WHERE id = 1") is not True:
                raise AssertionError("source-visible stream-end state was not retained")
            if scalar(connection, 'SELECT count(*) FROM circles_app."liveViewers" WHERE "streamId" = 1') != 1:
                raise AssertionError("stream-end unexpectedly removed retained viewer history")
            if scalar(connection, 'SELECT count(*) FROM circles_app."liveChat" WHERE "streamId" = 1') != 1:
                raise AssertionError("stream-end unexpectedly removed retained chat history")
            if scalar(connection, 'SELECT count(*) FROM circles_app."liveSignals" WHERE "streamId" = 1') != 0:
                raise AssertionError("stream-end did not remove transient signals")
            if scalar(connection, 'SELECT "streamId" IS NULL FROM circles_app."activeHostLeases" WHERE "hostId" = 1') is not True:
                raise AssertionError("stream-end did not clear current host lease pointer")

            # liveViewers and liveChat each RESTRICT a physical stream delete while their retained history remains.
            expect_sqlstate(connection, "DELETE FROM circles_app.streams WHERE id = 1", "23503")
            connection.execute('DELETE FROM circles_app."liveViewers" WHERE "streamId" = 1')
            expect_sqlstate(connection, "DELETE FROM circles_app.streams WHERE id = 1", "23503")
            connection.execute('DELETE FROM circles_app."liveChat" WHERE "streamId" = 1')
            connection.execute("DELETE FROM circles_app.streams WHERE id = 1")

        require_success(cluster.candidate(approved=True), "safe exact rerun after lifecycle proof")
        with cluster.connection() as connection:
            assert_exact_catalog(connection)
    except BaseException as error:
        close_cluster(cluster, error)
        raise
    else:
        close_cluster(cluster, None)


def prove_post_db03_rerun_refusal(fixture_sql: str) -> None:
    """DB-03 replaces runtime_circles_policy; DB-17 must fail closed instead of accepting it."""
    cluster = new_cluster(fixture_sql)
    try:
        seed_synthetic_rows(cluster)
        require_success(cluster.candidate(approved=True), "approved DB-17 run before DB-03 policy replacement")
        with cluster.connection() as connection:
            connection.execute("DROP POLICY runtime_circles_policy ON circles_app.circles")
            connection.execute(
                "CREATE POLICY db03_circles_select ON circles_app.circles "
                "FOR SELECT TO circles_app_runtime USING (true)"
            )
            connection.execute(
                "CREATE POLICY db03_circles_insert ON circles_app.circles "
                "FOR INSERT TO circles_app_runtime WITH CHECK (true)"
            )
            connection.execute(
                "CREATE POLICY db03_circles_update ON circles_app.circles "
                "FOR UPDATE TO circles_app_runtime USING (true) WITH CHECK (true)"
            )
            connection.execute(
                "CREATE POLICY db03_circles_delete ON circles_app.circles "
                "FOR DELETE TO circles_app_runtime USING (true)"
            )
        require_failure(
            cluster.candidate(approved=True),
            "DB-17 RLS policy inventory drift",
            "safe DB-17 rerun after DB-03 runtime_circles_policy replacement",
        )
        with cluster.connection() as connection:
            assert_exact_catalog(connection)
    except BaseException as error:
        close_cluster(cluster, error)
        raise
    else:
        close_cluster(cluster, None)


def main() -> int:
    if len(sys.argv) != 1:
        raise AssertionError("DB-17 isolated rehearsal accepts no target, DSN, or command-line arguments")
    if os.environ.get("CIRCLES_DB17_LOCAL_PG17") != "1":
        print("SKIP: set CIRCLES_DB17_LOCAL_PG17=1 for the disposable DB-17 PG17 rehearsal")
        return 0
    if os.geteuid() == 0:
        raise AssertionError("run the isolated PG17 drill as an unprivileged operating-system user")
    for binary in (INITDB, PG_CTL, PSQL, POSTGRES):
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise AssertionError(f"required PostgreSQL 17 binary is unavailable: {binary}")
    version = checked([POSTGRES, "--version"], clean_environment(Path(tempfile.gettempdir()), approved=False)).stdout
    if "PostgreSQL) 17" not in version:
        raise AssertionError(f"expected PostgreSQL 17, got {version!r}")
    if not CANDIDATE_SQL.is_file():
        raise AssertionError(f"missing candidate SQL: {CANDIDATE_SQL}")

    unit_root = UNIT_ROOT.resolve()
    try:
        FIXTURE_SQL.relative_to(unit_root)
    except ValueError as error:
        raise AssertionError("DB-17 fixture must resolve inside the project unit") from error
    if not FIXTURE_SQL.is_file():
        raise AssertionError(f"missing pinned DB-17 schema fixture: {FIXTURE_RELATIVE_PATH}")
    fixture_bytes = FIXTURE_SQL.read_bytes()
    fixture_hash = hashlib.sha256(fixture_bytes).hexdigest()
    if fixture_hash != FIXTURE_SHA256:
        raise AssertionError(
            "DB-17 fixture SHA-256 mismatch; refuse modified fixture "
            f"(expected {FIXTURE_SHA256}, got {fixture_hash})"
        )
    fixture_sql = fixture_bytes.decode("utf-8")

    checks: list[str] = []
    prove_inactive_gates(fixture_sql)
    checks.append("dual inactive approval gates refuse missing acknowledgement and lifecycle token")
    prove_historical_orphan_refusal(fixture_sql)
    checks.append("invalid historical scalar reference refuses before FK installation")
    prove_index_and_constraint_drift_refusal(fixture_sql)
    checks.append("wrong named child index and wrong named FK fail closed")
    prove_transaction_runner_refusal(fixture_sql)
    checks.append("transaction-wrapping runner is refused by concurrent-index requirement")
    prove_all_actions_and_stream_end_preservation(fixture_sql)
    checks.append("all seven selected delete actions, validation, rerun, and retained stream-end state")
    prove_post_db03_rerun_refusal(fixture_sql)
    checks.append("post-DB-03 runtime_circles_policy replacement makes DB-17 rerun refuse without relaxing guard")
    print(json.dumps({
        "passed": True,
        "production_access": False,
        "production_write": False,
        "fixture": "fresh-loopback-postgresql-17",
        "schema_fixture": str(FIXTURE_RELATIVE_PATH),
        "schema_fixture_sha256": fixture_hash,
        "checks": checks,
        "disposable_fixtures_removed": True,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
