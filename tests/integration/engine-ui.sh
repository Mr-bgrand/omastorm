#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=tests/integration/common.sh
source "$(dirname "$0")/common.sh"
cd "$(dirname "$0")/../.."
check_dir="$PWD/target/check-engine-ui"
mkdir -p "$check_dir"
stage_ui "$check_dir"
cp tests/harnesses/engine-ui.qml "$check_dir/shell.qml"
OMASTORM_QML="$check_dir/shell.qml" bash run.sh > "$check_dir/result.log" 2>&1
cat "$check_dir/result.log"
rg -q ENGINE_UI_PASSED "$check_dir/result.log"
check_qml_log "$check_dir/result.log"
