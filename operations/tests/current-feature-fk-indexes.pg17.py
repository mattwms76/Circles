#!/usr/bin/env python3
"""Disposable PostgreSQL 17 proof for current_feature_fk_indexes.sql.

This script accepts no DSN or target arguments. It initializes a temporary loopback-only
PostgreSQL 17 cluster, runs the candidate SQL through psql, and removes the cluster in all
cases. Invoke it with only PATH, HOME, and CI retained in the environment.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import psycopg


UNIT_ROOT = Path(__file__).resolve().parents[2]
SQL_PATH = UNIT_ROOT / "operations/remediation/current_feature_fk_indexes.sql"
PG_BIN = Path("/usr/lib/postgresql/17/bin")
INITDB = PG_BIN / "initdb"
PG_CTL = PG_BIN / "pg_ctl"
PSQL = PG_BIN / "psql"
POSTGRES = PG_BIN / "postgres"

TARGETS = (
    (
        "circles_admin",
        "review_handoffs_assignee_operator_id_fk_idx",
        "CREATE INDEX review_handoffs_assignee_operator_id_fk_idx ON circles_admin.review_handoffs USING btree (assignee_operator_id)",
    ),
    (
        "circles_publish",
        "circle_prompts_updated_by_fk_idx",
        'CREATE INDEX circle_prompts_updated_by_fk_idx ON circles_publish."circlePrompts" USING btree ("updatedBy")',
    ),
    (
        "circles_publish",
        "prompt_posts_circle_id_fk_idx",
        'CREATE INDEX prompt_posts_circle_id_fk_idx ON circles_publish."promptPosts" USING btree ("circleId")',
    ),
)
TARGET_NAMES = tuple(target[1] for target in TARGETS)

BASELINE_SQL = """
CREATE SCHEMA circles_admin;
CREATE SCHEMA circles_app;
CREATE SCHEMA circles_publish;

CREATE TABLE circles_admin.operators (id uuid PRIMARY KEY);
CREATE TABLE circles_app.users (id integer PRIMARY KEY);
CREATE TABLE circles_app.circles (id integer PRIMARY KEY);

CREATE TABLE circles_admin.review_handoffs (
  case_id integer NOT NULL,
  circle_id integer NOT NULL,
  assignee_operator_id uuid NOT NULL,
  CONSTRAINT review_handoffs_assignee_operator_id_fkey
    FOREIGN KEY (assignee_operator_id)
    REFERENCES circles_admin.operators(id)
    ON DELETE CASCADE
);
CREATE TABLE circles_publish."circlePrompts" (
  "circleId" integer NOT NULL,
  body varchar(180) NOT NULL,
  "updatedBy" integer NOT NULL,
  CONSTRAINT "circlePrompts_updatedBy_fkey"
    FOREIGN KEY ("updatedBy")
    REFERENCES circles_app.users(id)
    ON DELETE RESTRICT,
  PRIMARY KEY ("circleId")
);
CREATE TABLE circles_publish."promptPosts" (
  "postId" integer NOT NULL,
  "circleId" integer NOT NULL,
  "promptBody" varchar(180) NOT NULL,
  CONSTRAINT "promptPosts_circleId_fkey"
    FOREIGN KEY ("circleId")
    REFERENCES circles_app.circles(id)
    ON DELETE CASCADE,
  PRIMARY KEY ("postId")
);

INSERT INTO circles_admin.operators(id) VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO circles_app.users(id) VALUES (101);
INSERT INTO circles_app.circles(id) VALUES (101), (201);
INSERT INTO circles_admin.review_handoffs(case_id, circle_id, assignee_operator_id)
  VALUES (1, 201, '00000000-0000-0000-0000-000000000001');
INSERT INTO circles_publish."circlePrompts"("circleId", body, "updatedBy")
  VALUES (201, 'synthetic prompt', 101);
INSERT INTO circles_publish."promptPosts"("postId", "circleId", "promptBody")
  VALUES (301, 201, 'synthetic prompt');
"""


def clean_environment() -> dict[str, str]:
    """Pass only the explicitly allowed harmless runner variables to child processes."""
    return {key: os.environ[key] for key in ("PATH", "HOME", "CI")}


def run(
    command: Iterable[str | Path], *, allow_failure: bool = False
) -> subprocess.CompletedProcess[str]:
    rendered = [str(part) for part in command]
    result = subprocess.run(
        rendered,
        check=False,
        capture_output=True,
        encoding="utf-8",
        env=clean_environment(),
        timeout=180,
    )
    if not allow_failure and result.returncode != 0:
        raise AssertionError(
            "command failed ({}):\n{}\n{}".format(
                " ".join(rendered), result.stdout, result.stderr
            )
        )
    return result


def unused_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


@dataclass
class SyntheticPg17:
    temporary_directory: tempfile.TemporaryDirectory[str]
    port: int
    started: bool = False

    @property
    def root(self) -> Path:
        return Path(self.temporary_directory.name)

    @property
    def data_directory(self) -> Path:
        return self.root / "data"

    def psql(self, *extra: str, single_transaction: bool = False) -> subprocess.CompletedProcess[str]:
        command: list[str | Path] = [PSQL, "-X"]
        if single_transaction:
            command.append("-1")
        command.extend(
            [
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
                *extra,
            ]
        )
        return run(command)

    def connection(self) -> psycopg.Connection:
        return psycopg.connect(
            host="127.0.0.1",
            port=self.port,
            user="postgres",
            dbname="postgres",
            autocommit=True,
        )

    def __enter__(self) -> "SyntheticPg17":
        run(
            [
                INITDB,
                "-D",
                self.data_directory,
                "-U",
                "postgres",
                "--no-locale",
                "--encoding=UTF8",
                "--auth-local=trust",
                "--auth-host=trust",
            ]
        )
        run(
            [
                PG_CTL,
                "-D",
                self.data_directory,
                "-l",
                self.root / "postgres.log",
                "-o",
                f"-h 127.0.0.1 -p {self.port} -k {self.root}",
                "-w",
                "start",
            ]
        )
        self.started = True
        baseline = self.root / "baseline.sql"
        baseline.write_text(BASELINE_SQL, encoding="utf-8")
        self.psql("-f", str(baseline))
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        if self.started:
            run(
                [PG_CTL, "-D", self.data_directory, "-m", "fast", "-w", "stop"],
                allow_failure=True,
            )
        self.temporary_directory.cleanup()


def synthetic_cluster() -> SyntheticPg17:
    return SyntheticPg17(tempfile.TemporaryDirectory(prefix="circles-current-feature-fk-pg17-"), unused_loopback_port())


def execute(cluster: SyntheticPg17, statement: str) -> None:
    with cluster.connection() as connection, connection.cursor() as cursor:
        cursor.execute(statement)


def scalar(cluster: SyntheticPg17, statement: str):
    with cluster.connection() as connection, connection.cursor() as cursor:
        cursor.execute(statement)
        row = cursor.fetchone()
    assert row is not None
    return row[0]


def target_index_count(cluster: SyntheticPg17) -> int:
    quoted_names = ", ".join(repr(name) for name in TARGET_NAMES)
    return int(
        scalar(
            cluster,
            "SELECT count(*) FROM pg_catalog.pg_class AS relation "
            "JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace "
            f"WHERE relation.relname IN ({quoted_names}) "
            "AND namespace.nspname IN ('circles_admin', 'circles_publish')",
        )
    )


def synthetic_row_counts(cluster: SyntheticPg17) -> tuple[int, int, int]:
    with cluster.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT "
            "(SELECT count(*) FROM circles_admin.review_handoffs), "
            "(SELECT count(*) FROM circles_publish.\"circlePrompts\"), "
            "(SELECT count(*) FROM circles_publish.\"promptPosts\")"
        )
        row = cursor.fetchone()
    assert row is not None
    return tuple(int(value) for value in row)


def related_index_count(cluster: SyntheticPg17) -> int:
    return int(
        scalar(
            cluster,
            "SELECT count(*) FROM pg_catalog.pg_index AS index_metadata "
            "WHERE index_metadata.indrelid IN ("
            "'circles_admin.review_handoffs'::pg_catalog.regclass, "
            "'circles_publish.\"circlePrompts\"'::pg_catalog.regclass, "
            "'circles_publish.\"promptPosts\"'::pg_catalog.regclass)",
        )
    )


def assert_exact_indexes(cluster: SyntheticPg17) -> None:
    expected = {(schema, name): definition for schema, name, definition in TARGETS}
    with cluster.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT namespace.nspname, relation.relname, "
            "pg_catalog.pg_get_indexdef(index_metadata.indexrelid), "
            "index_metadata.indisvalid, index_metadata.indisready, index_metadata.indislive, "
            "access_method.amname, index_metadata.indnkeyatts, index_metadata.indnatts, "
            "index_metadata.indpred IS NULL, index_metadata.indexprs IS NULL "
            "FROM pg_catalog.pg_index AS index_metadata "
            "JOIN pg_catalog.pg_class AS relation ON relation.oid = index_metadata.indexrelid "
            "JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace "
            "JOIN pg_catalog.pg_class AS table_relation ON table_relation.oid = index_metadata.indrelid "
            "JOIN pg_catalog.pg_am AS access_method ON access_method.oid = relation.relam "
            "WHERE (namespace.nspname, relation.relname) IN ("
            "('circles_admin', 'review_handoffs_assignee_operator_id_fk_idx'), "
            "('circles_publish', 'circle_prompts_updated_by_fk_idx'), "
            "('circles_publish', 'prompt_posts_circle_id_fk_idx')) "
            "ORDER BY namespace.nspname, relation.relname"
        )
        rows = cursor.fetchall()

    assert len(rows) == 3, f"expected three exact indexes, got {rows!r}"
    for schema, name, definition, valid, ready, live, access_method, key_count, attribute_count, no_predicate, no_expression in rows:
        assert definition == expected[(schema, name)], (schema, name, definition)
        assert (valid, ready, live) == (True, True, True), (schema, name, valid, ready, live)
        assert access_method == "btree", (schema, name, access_method)
        assert (key_count, attribute_count) == (1, 1), (schema, name, key_count, attribute_count)
        assert (no_predicate, no_expression) == (True, True), (schema, name)


def run_candidate(cluster: SyntheticPg17, *, single_transaction: bool = False) -> subprocess.CompletedProcess[str]:
    command: list[str] = [
        "-v",
        "current_feature_fk_indexes_confirm_no_transaction=1",
        "-f",
        str(SQL_PATH),
    ]
    if single_transaction:
        # Keep the actual candidate file unchanged; psql -1 simulates prohibited runner use.
        psql_command: list[str | Path] = [
            PSQL,
            "-X",
            "-1",
            "-h",
            "127.0.0.1",
            "-p",
            str(cluster.port),
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            *command,
        ]
        return run(psql_command, allow_failure=True)
    psql_command = [
        PSQL,
        "-X",
        "-h",
        "127.0.0.1",
        "-p",
        str(cluster.port),
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        *command,
    ]
    return run(psql_command, allow_failure=True)


def output(result: subprocess.CompletedProcess[str]) -> str:
    return f"{result.stdout}\n{result.stderr}"


def require_success(result: subprocess.CompletedProcess[str], label: str) -> None:
    if result.returncode != 0:
        raise AssertionError(f"{label} unexpectedly failed:\n{output(result)}")


def require_failure(result: subprocess.CompletedProcess[str], expected: str, label: str) -> None:
    assert result.returncode != 0, f"{label} unexpectedly succeeded"
    assert expected in output(result), f"{label} did not report {expected!r}:\n{output(result)}"


def prove_wrong_named_index_refusal() -> None:
    with synthetic_cluster() as cluster:
        execute(
            cluster,
            "CREATE INDEX review_handoffs_assignee_operator_id_fk_idx "
            "ON circles_admin.review_handoffs USING btree (case_id)",
        )
        result = run_candidate(cluster)
        require_failure(result, "current-feature FK-index definition drift", "wrong named-index refusal")
        assert target_index_count(cluster) == 1, "preflight created another index after wrong-name refusal"


def prove_wrong_fk_refusal() -> None:
    with synthetic_cluster() as cluster:
        execute(
            cluster,
            "ALTER TABLE circles_publish.\"circlePrompts\" "
            "DROP CONSTRAINT \"circlePrompts_updatedBy_fkey\"",
        )
        execute(
            cluster,
            "ALTER TABLE circles_publish.\"circlePrompts\" "
            "ADD CONSTRAINT \"circlePrompts_updatedBy_fkey\" "
            "FOREIGN KEY (\"updatedBy\") REFERENCES circles_app.circles(id) ON DELETE CASCADE",
        )
        result = run_candidate(cluster)
        require_failure(result, "current-feature FK-index foreign-key contract drift", "wrong FK refusal")
        assert target_index_count(cluster) == 0, "preflight created an index after wrong-FK refusal"


def prove_transaction_misuse_refusal() -> None:
    with synthetic_cluster() as cluster:
        result = run_candidate(cluster, single_transaction=True)
        require_failure(
            result,
            "CREATE INDEX CONCURRENTLY cannot run inside a transaction block",
            "single-transaction runner refusal",
        )
        assert target_index_count(cluster) == 0, "transaction misuse left a target index behind"


def prove_success_and_safe_rerun() -> None:
    with synthetic_cluster() as cluster:
        counts_before = synthetic_row_counts(cluster)
        related_indexes_before = related_index_count(cluster)

        first = run_candidate(cluster)
        require_success(first, "first normal candidate run")
        assert_exact_indexes(cluster)
        assert synthetic_row_counts(cluster) == counts_before, "first run changed synthetic rows"
        assert related_index_count(cluster) == related_indexes_before + 3, "first run changed non-target index inventory"

        second = run_candidate(cluster)
        require_success(second, "safe rerun")
        assert_exact_indexes(cluster)
        assert synthetic_row_counts(cluster) == counts_before, "safe rerun changed synthetic rows"
        assert related_index_count(cluster) == related_indexes_before + 3, "safe rerun changed index inventory"


def main() -> int:
    if len(sys.argv) != 1:
        raise AssertionError("this isolated PG17 drill accepts no target, DSN, or other arguments")
    if os.geteuid() == 0:
        raise AssertionError("run the isolated PG17 drill as an unprivileged user; initdb refuses root")
    for binary in (INITDB, PG_CTL, PSQL, POSTGRES):
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise AssertionError(f"required PostgreSQL 17 binary is unavailable: {binary}")
    version = run([POSTGRES, "--version"]).stdout
    assert "PostgreSQL) 17" in version, f"expected PostgreSQL 17, got {version!r}"
    assert SQL_PATH.is_file(), f"candidate SQL is missing: {SQL_PATH}"

    prove_wrong_named_index_refusal()
    prove_wrong_fk_refusal()
    prove_transaction_misuse_refusal()
    prove_success_and_safe_rerun()
    print("PASS: isolated PostgreSQL 17 actual-SQL proof covered wrong named-index/FK refusal, transaction misuse, exact creation, and safe rerun.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    finally:
        # Every SyntheticPg17 context stops its loopback server and deletes its fixture root.
        pass
