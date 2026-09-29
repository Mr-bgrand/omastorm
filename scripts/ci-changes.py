#!/usr/bin/env python3
"""Select CI jobs from the complete Git diff; unknown paths select everything."""
import argparse
import json
import os
from pathlib import Path
import subprocess

GROUPS = ("engine", "ui", "installer", "pin", "release", "shell", "rendering")


def classify(paths, full=False):
    selected = set(GROUPS) if full else set()
    for path in paths:
        if path.startswith(".github/workflows/") or path in {
            "mise.toml", "scripts/check.sh", "scripts/cargo.sh",
            "scripts/prepare-pinned-ui-check.sh",
        } or path.startswith("scripts/ci-"):
            selected.update(GROUPS)
        elif path == "engine/release.pin":
            selected.update(("pin", "ui"))
        elif path.endswith(".md") or path.startswith(("docs/", "site/", "branding/")) or path in {
            "LICENSE", ".gitignore", ".all-contributorsrc", ".github/FUNDING.yml", ".github/release.yml",
        } or path.startswith(".github/ISSUE_TEMPLATE/"):
            pass
        elif path.startswith(("engine/", "data/", "golden/")) or path in {"Cargo.toml", "Cargo.lock"}:
            selected.update(("engine", "ui"))
            if path == "engine/tests/rendering.rs":
                selected.add("rendering")
        elif path.startswith(("ui/", "tests/")):
            selected.add("ui")
            if path.startswith("ui/shaders/") or path in {"ui/RadarMap.qml", "ui/RadarWindow.qml", "ui/PluginSession.qml", "tests/map-tiles.qml"}:
                selected.add("rendering")
        elif path in {
            "run.sh", "manifest.json", "scripts/fetch-engine.sh", "scripts/engine-pin.sh",
            "scripts/link-plugin.sh", "scripts/write-desktop-entry.sh", "scripts/test-engine-pin.sh",
            "scripts/check-bind.sh", "scripts/check-link-plugin.sh", "scripts/check-launcher.sh",
        }:
            selected.add("installer")
            if path in {"run.sh", "manifest.json"}:
                selected.add("ui")
        elif path in {
            "scripts/build-engine-release.sh", "scripts/package-engine-release.sh",
            "scripts/bump-engine-version.sh", "scripts/tag-engine-release.sh",
            "scripts/pin-engine-release.sh", "scripts/release-engine.sh",
            "scripts/require-origin-main.sh", "scripts/check-engine-release.sh",
            "scripts/check-engine-binary.sh",
        }:
            selected.add("release")
        elif path in {"scripts/extract-fixtures.sh", "scripts/refresh-fixtures.sh", "scripts/bench-engine.py", "scripts/dev-bootstrap.sh"}:
            selected.update(("engine", "ui"))
        elif path == "scripts/build-shader.sh":
            selected.update(("ui", "rendering"))
        elif path.startswith("scripts/check-") or path == "scripts/hooks/omastorm":
            selected.add("ui")
        elif path.startswith("scripts/capture-"):
            pass
        else:
            selected.update(GROUPS)
        if path.endswith(".sh") or path == "scripts/hooks/omastorm":
            selected.add("shell")
    return {group: group in selected for group in GROUPS}


def git(*args):
    return subprocess.check_output(["git", *args], stderr=subprocess.PIPE)


def changed_paths(base, head):
    # New branches compare to main. If that history is unavailable, check everything.
    if not base or set(base) == {"0"}:
        try:
            base = git("merge-base", "origin/main", head).decode().strip()
            if base == git("rev-parse", head).decode().strip():
                base = None
        except subprocess.CalledProcessError:
            base = None
    elif os.environ.get("GITHUB_EVENT_NAME") == "pull_request":
        base = git("merge-base", base, head).decode().strip()
    if base:
        paths = git("diff", "--name-only", "--no-renames", "-z", base, head)
    else:
        paths = git("ls-files", "-z")
    return base, [p for p in paths.decode().split("\0") if p]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--full", action="store_true")
    args = parser.parse_args()
    base, paths = changed_paths(args.base, args.head)
    groups = classify(paths, args.full or base is None)
    # These cheap checks apply even when all expensive jobs are omitted.
    subprocess.run(["git", "diff", "--check", base, args.head] if base else
                   ["git", "show", "--format=", "--check", args.head], check=True)
    for name in paths:
        path = Path(name)
        if (path.suffix == ".json" or name == ".all-contributorsrc") and path.is_file():
            json.loads(path.read_text())
    report = {"base": base, "paths": paths, "groups": groups}
    Path("target").mkdir(exist_ok=True)
    Path("target/ci-changes.json").write_text(json.dumps(report, indent=2) + "\n")
    for group, enabled in groups.items():
        print(f"{group}={str(enabled).lower()}")
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a") as out:
            out.write("## Selected checks\n\n| Group | Run |\n|---|---|\n")
            for group, enabled in groups.items():
                out.write(f"| {group} | {'yes' if enabled else 'no'} |\n")
            if groups["rendering"]:
                out.write("\nGPU rendering tests and review captures are also required locally.\n")


if __name__ == "__main__":
    main()
