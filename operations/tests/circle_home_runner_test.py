"""Runner-only safety tests; fake tool processes, never open a database connection."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

# Driver behavior is not exercised here. Do not require a locally installed psycopg just to
# test runner environment/cleanup control flow before CI provisions its actual PG17 tools.
_driver = types.ModuleType("psycopg")
_driver.sql = types.SimpleNamespace()
sys.modules["psycopg"] = _driver
spec = importlib.util.spec_from_file_location(
    "circle_home_runner", Path(__file__).resolve().parents[2] / "scripts/run-circle-home-e2e.py"
)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerSafety(unittest.TestCase):
    def simulate(self, *, stop_fails=False, partial_start=False, suite="circle-home"):
        folder = Path(tempfile.mkdtemp(prefix="circle-home-runner-unit-"))
        calls = []
        processes = []
        evidence = None
        try:
            def tooling(argv, env, **_kwargs):
                calls.append(argv)
                if argv[-1] == "start" and partial_start:
                    (folder / "data").mkdir()
                    (folder / "data/postmaster.pid").write_text("123\n")
                    raise subprocess.TimeoutExpired("fixture-start", 1)
                if argv[-1] == "stop" and stop_fails:
                    raise RuntimeError("fixed synthetic stop failure")

            def process(argv, **_kwargs):
                processes.append(argv)
                if argv[-1] == "--version":
                    output = "initdb (PostgreSQL) 17.11\n" if "initdb" in argv[0] else "v22.23.4\n"
                    return types.SimpleNamespace(returncode=0, stdout=output)
                return types.SimpleNamespace(returncode=0, stdout="")

            output = io.StringIO()
            with patch.object(Path, "is_file", return_value=True), \
                 patch.object(runner.tempfile, "mkdtemp", return_value=str(folder)), \
                 patch.object(runner, "checked", side_effect=tooling), \
                 patch.object(runner, "apply_fixture_schema"), \
                 patch.object(runner.subprocess, "run", side_effect=process), \
                 contextlib.redirect_stdout(output):
                code = runner.main(["--suite", suite])
            evidence = json.loads(output.getvalue().splitlines()[-1])
            return code, evidence, calls, processes, folder.exists()
        finally:
            if folder.exists():
                shutil.rmtree(folder)

    def test_child_environment_excludes_database_and_signing_credentials(self):
        with patch.dict(runner.os.environ, {
            "DATABASE_URL": "redacted-placeholder",
            "SUPABASE_DATABASE_URL": "redacted-placeholder",
            "MANUS_JWT_SECRET": "redacted-placeholder",
            "PGPASSWORD": "redacted-placeholder",
        }):
            env = runner.fixture_environment(Path("/tmp/synthetic-home"))
        for key in ("DATABASE_URL", "SUPABASE_DATABASE_URL", "MANUS_JWT_SECRET", "PGPASSWORD"):
            self.assertNotIn(key, env)
        self.assertEqual(env["NODE_ENV"], "test")

    def test_clean_success_removes_fixture(self):
        code, evidence, calls, _processes, remains = self.simulate()
        self.assertEqual(code, 0)
        self.assertTrue(evidence["passed"])
        self.assertTrue(evidence["disposable_fixture_removed"])
        self.assertFalse(remains)
        self.assertTrue(any(call[-1] == "stop" for call in calls))
        activity_code, activity_evidence, _activity_calls, processes, activity_remains = self.simulate(suite="activity")
        self.assertEqual(activity_code, 0)
        self.assertEqual(activity_evidence["suite"], "activity-isolated-http-e2e")
        self.assertFalse(activity_remains)
        activity_run = next(argv for argv in processes if "vitest.mjs" in argv[1])
        self.assertEqual(activity_run[activity_run.index("--config") + 1], "e2e/activity.e2e.config.ts")
        with patch.object(Path, "is_file", return_value=True):
            self.assertEqual(
                runner.fixture_migrations("activity")[-2:],
                runner.ACTIVITY_MIGRATIONS,
            )

    def test_stop_failure_cannot_report_success_or_remove_live_data(self):
        code, evidence, calls, _processes, remains = self.simulate(stop_fails=True)
        self.assertEqual(code, 1)
        self.assertFalse(evidence["passed"])
        self.assertFalse(evidence["disposable_fixture_removed"])
        self.assertTrue(remains)
        self.assertTrue(any("immediate" in call for call in calls))

    def test_partial_start_timeout_still_stops_its_owned_cluster(self):
        code, evidence, calls, _processes, remains = self.simulate(partial_start=True)
        self.assertEqual(code, 1)
        self.assertFalse(evidence["passed"])
        self.assertTrue(evidence["disposable_fixture_removed"])
        self.assertTrue(any(call[-1] == "stop" for call in calls))
        self.assertFalse(remains)

if __name__ == "__main__":
    unittest.main()
