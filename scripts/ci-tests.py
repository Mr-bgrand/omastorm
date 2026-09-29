#!/usr/bin/env python3
"""Regression checks for CI selection, especially paths that skip expensive jobs."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
from unittest.mock import patch
import unittest

spec = importlib.util.spec_from_file_location("changes", Path(__file__).with_name("ci-changes.py"))
changes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(changes)


class SelectionTests(unittest.TestCase):
    def selected(self, *paths):
        return {k for k, v in changes.classify(paths).items() if v}

    def test_scenarios(self):
        cases = [
            (("README.md", "engine/README.md", "site/index.html", "branding/mark.png"), set()),
            ((".all-contributorsrc", "README.md"), set()),
            (("ui/Panel.qml",), {"ui"}),
            (("engine/src/sweep.rs",), {"engine", "ui"}),
            (("engine/src/protocol.rs", "ui/Engine.qml"), {"engine", "ui"}),
            (("Cargo.lock",), {"engine", "ui"}),
            (("data/fixtures/scan.gz", "golden/scan.json"), {"engine", "ui"}),
            (("engine/release.pin",), {"pin", "ui"}),
            (("scripts/fetch-engine.sh",), {"installer", "shell"}),
            (("run.sh",), {"installer", "shell", "ui"}),
            (("manifest.json",), {"installer", "ui"}),
            (("scripts/build-engine-release.sh",), {"release", "shell"}),
            (("ui/shaders/radar.frag",), {"ui", "rendering"}),
            (("ui/RadarMap.qml",), {"ui", "rendering"}),
            (("ui/RadarWindow.qml",), {"ui", "rendering"}),
            (("scripts/capture-demo.sh",), {"shell"}),
            (("mise.toml",), set(changes.GROUPS)),
            ((".github/workflows/engine.yml",), set(changes.GROUPS)),
            (("new-runtime-file",), set(changes.GROUPS)),
        ]
        for paths, expected in cases:
            with self.subTest(paths=paths):
                self.assertEqual(self.selected(*paths), expected)

    def test_mixed_changes_and_full_override(self):
        self.assertEqual(self.selected("ui/Panel.qml", "scripts/fetch-engine.sh", "README.md"),
                         {"ui", "installer", "shell"})
        self.assertTrue(all(changes.classify(["README.md"], full=True).values()))

    def test_diff_includes_deleted_and_renamed_paths_and_all_commits(self):
        with tempfile.TemporaryDirectory() as scratch:
            previous = os.getcwd()
            try:
                os.chdir(scratch)
                subprocess.run(["git", "init", "-q"], check=True)
                subprocess.run(["git", "config", "user.name", "CI test"], check=True)
                subprocess.run(["git", "config", "user.email", "ci@example.invalid"], check=True)
                def commit():
                    subprocess.run(["git", "add", "-A"], check=True)
                    subprocess.run(["git", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"], check=True)
                Path("engine").mkdir()
                Path("engine/old.rs").write_text("engine source\n")
                commit()
                base = changes.git("rev-parse", "HEAD").decode().strip()
                Path("engine/old.rs").rename("README.md")
                commit()
                Path("ui").mkdir()
                Path("ui/Panel.qml").write_text("Item {}\n")
                commit()
                actual_base, paths = changes.changed_paths(base, "HEAD")
                self.assertEqual(actual_base, base)
                self.assertEqual(set(paths), {"engine/old.rs", "README.md", "ui/Panel.qml"})
                self.assertTrue(changes.classify(paths)["engine"])
                actual_base, paths = changes.changed_paths("0" * 40, "HEAD")
                self.assertIsNone(actual_base)
                self.assertIn("ui/Panel.qml", paths)
            finally:
                os.chdir(previous)


class ContributorMetadataTests(unittest.TestCase):
    def test_json_validation(self):
        with tempfile.TemporaryDirectory() as scratch:
            previous = os.getcwd()
            try:
                os.chdir(scratch)
                with patch("sys.argv", ["ci-changes.py"]), \
                     patch.object(changes, "changed_paths", return_value=("base", [".all-contributorsrc", "README.md"])), \
                     patch.object(changes.subprocess, "run"), \
                     patch.dict(os.environ, GITHUB_STEP_SUMMARY=""), patch("builtins.print"):
                    Path(".all-contributorsrc").write_text('{"contributors": []}\n')
                    changes.main()
                    report = json.loads(Path("target/ci-changes.json").read_text())
                    self.assertFalse(any(report["groups"].values()))
                    Path(".all-contributorsrc").write_text('{"contributors": [}\n')
                    with self.assertRaises(json.JSONDecodeError):
                        changes.main()
                    # Deleted metadata does not need parsing.
                    Path(".all-contributorsrc").unlink()
                    changes.main()
            finally:
                os.chdir(previous)


class RequiredGateTests(unittest.TestCase):
    def test_selected_jobs_cannot_fail_or_be_skipped(self):
        workflow = Path(__file__).resolve().parent.parent / ".github/workflows/engine.yml"
        # Exercise the exact final-gate program without needing a GitHub runner.
        content = workflow.read_text().split("  required:\n", 1)[1]
        program = textwrap.dedent(content.split("python3 - <<'PY'\n", 1)[1].split("          PY", 1)[0])
        for paths in [("README.md",), (".all-contributorsrc", "README.md"), ("ui/Panel.qml",), ("engine/src/main.rs",),
                      ("scripts/fetch-engine.sh",), ("engine/release.pin",),
                      ("scripts/build-engine-release.sh",), ("mise.toml",)]:
            scope = {k: str(v).lower() for k, v in changes.classify(paths).items()}
            enabled = {
                "changes": True,
                "shell": scope["shell"] == "true",
                "pin": scope["pin"] == "true",
                "native-x86": scope["engine"] == "true" or scope["release"] == "true",
                "native-arm": scope["engine"] == "true" or scope["release"] == "true",
                "ui": scope["ui"] == "true" or scope["installer"] == "true",
                "bundle": scope["engine"] == "true" or scope["release"] == "true",
            }
            jobs = {name: {"result": "success" if run else "skipped"} for name, run in enabled.items()}
            jobs["changes"]["outputs"] = scope
            with self.subTest(paths=paths), patch.dict(os.environ, RESULTS=json.dumps(jobs)), patch("builtins.print"):
                exec(program, {})
            for name, run in enabled.items():
                if not run:
                    continue
                for status in ("failure", "cancelled", "skipped"):
                    bad = {k: dict(v) for k, v in jobs.items()}
                    bad[name]["result"] = status
                    with self.subTest(paths=paths, job=name, status=status), patch.dict(os.environ, RESULTS=json.dumps(bad)):
                        with self.assertRaises(SystemExit):
                            exec(program, {})


if __name__ == "__main__":
    unittest.main()
