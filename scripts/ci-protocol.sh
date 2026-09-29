#!/usr/bin/env bash
# Version equality declares compatibility; integration tests check behavior.
set -euo pipefail
cd "$(dirname "$0")/.."
engine=$(sed -n 's/^pub const VERSION: u32 = \([0-9][0-9]*\);$/\1/p' engine/src/protocol.rs)
ui=$(rg -o 'message\.v !== ([0-9]+)' -r '$1' ui/Engine.qml || true)
[[ $engine =~ ^[0-9]+$ && $ui =~ ^[0-9]+$ ]] || {
  echo 'Could not determine unique engine/UI protocol versions.' >&2
  exit 1
}
printf 'engine=%s\nui=%s\n' "$engine" "$ui"
if [[ $engine == "$ui" ]]; then echo 'compatible=true'; else echo 'compatible=false'; fi
