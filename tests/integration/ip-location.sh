#!/usr/bin/env bash
# Consent IP location through the shared session: stub curl, no network,
# personal configuration, shell bootstrap, or shared daemon.
set -euo pipefail
# shellcheck source=tests/integration/common.sh
source "$(dirname "$0")/common.sh"
cd "$(dirname "$0")/../.."
scratch=$(mktemp -d "${TMPDIR:?}/omastorm-ip-check.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/bin" "$scratch/runtime"
stage_ui "$scratch/ui"
printf ' .pragma library\nvar settings = {development:true};\n' > "$scratch/ui/Instance.js"

fixture='{"nearest_area":[{"areaName":[{"value":"Stamford"}],"latitude":"41.05","longitude":"-73.54"}]}'
printf '%s\n' "$fixture" > "$scratch/ok.json"
cat > "$scratch/bin/curl" <<EOF
#!/bin/bash
echo "\$*" >> "$scratch/curl.log"
# Last non-flag argument is the URL (OMASTORM_LOCATION_URL or wttr.in).
url=\${@: -1}
if [[ \$url == file://* ]]; then
  cat -- "\${url#file://}"
else
  cat -- "$scratch/ok.json"
fi
EOF
chmod +x "$scratch/bin/curl"

cp tests/harnesses/ip-location.qml "$scratch/ui/Test.qml"

OMASTORM_CONFIG="$scratch/empty.toml" OMASTORM_STATE="$scratch/state.json" \
  OMASTORM_LOCATION_URL="file://$scratch/ok.json" \
  PATH="$scratch/bin:$PATH" \
  XDG_RUNTIME_DIR="$scratch/runtime" QT_QPA_PLATFORM=offscreen \
  timeout 20 quickshell -p "$scratch/ui/Test.qml" > "$scratch/log" 2>&1 || { cat "$scratch/log"; exit 1; }
cat "$scratch/log"
rg -q IP_LOCATION_PASSED "$scratch/log"
! rg -q 'ReferenceError|TypeError|Binding loop|Unable to assign' "$scratch/log"
