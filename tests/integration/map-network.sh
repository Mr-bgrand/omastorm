#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=tests/integration/common.sh
source "$(dirname "$0")/common.sh"
cd "$(dirname "$0")/../.."
# Harness outside the checkout: Omarchy rejects a shaders symlink in the plugin folder.
check_dir=$(mktemp -d "${TMPDIR:?}/omastorm-check-map-network.XXXXXX")
trap 'rm -rf "$check_dir"' EXIT
mkdir -p review
rm -f review/network-*.png
stage_ui "$check_dir"
cp tests/map-network.qml "$check_dir/shell.qml"
OMASTORM_QML="$check_dir/shell.qml" OMASTORM_REVIEW="$PWD/review" \
 timeout 100 bash run.sh > "$check_dir/result.log" 2>&1
cat "$check_dir/result.log"
rg -q MAP_NETWORK_PASSED "$check_dir/result.log"
check_qml_log "$check_dir/result.log"
