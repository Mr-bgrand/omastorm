#!/usr/bin/env bash
# Drive loading and hand-offs in the real window without live network feeds.
set -euo pipefail
# shellcheck source=tests/integration/common.sh
source "$(dirname "$0")/common.sh"
cd "$(dirname "$0")/../.."
check_dir=$(mktemp -d "${TMPDIR:-/tmp}/omastorm-handoff.XXXXXX")
trap 'rm -rf "$check_dir"' EXIT
stage_ui "$check_dir"
cp tests/radar-handoff.qml "$check_dir/shell.qml"
printf 'center_lat = 35.333\ncenter_lon = -97.278\n' > "$check_dir/config.toml"
mkdir -p review
OMASTORM_QML="$check_dir/shell.qml" OMASTORM_REVIEW="$PWD/review" \
  OMASTORM_CONFIG="$check_dir/config.toml" OMASTORM_STATE="$check_dir/state.json" OMASTORM_LOCATION=/dev/null \
  timeout 20 bash run.sh > "$check_dir/result.log" 2>&1
cat "$check_dir/result.log"
rg -q RADAR_HANDOFF_PASSED "$check_dir/result.log"
check_qml_log "$check_dir/result.log"
