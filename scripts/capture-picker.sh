#!/usr/bin/env bash
# The site picker (DESIGN.md, picker as built) as two captures over the
# quarter window on the shared daemon: open with the query "tul" over live
# KTLX, and the state after Enter, KINX selected and locked with the camera
# on its home view (review/picker-open.png, review/picker-chosen.png, and
# review/picker-sheet.png side by side). The daemon is left on KINX, unlocked.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p review
export OMASTORM_ARCHIVE=${OMASTORM_ARCHIVE:-$PWD/data/raw/KTLX20130520_201643_V06.gz} # the archived scan the checks assume
export QT_QPA_PLATFORM=offscreen QT_QPA_PLATFORMTHEME=basic QT_QUICK_BACKEND=rhi QSG_RHI_BACKEND=opengl
review="$PWD/review"
rm -f "$review"/picker-*.png
scratch=$(mktemp -d /tmp/omastorm-picker.XXXXXX)
cleanup() {
  jobs -pr > "$scratch/.jobs"
  xargs -r kill -KILL < "$scratch/.jobs" 2>/dev/null || true
  wait || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
jq -r '.sites[] | select(.id=="KTLX") | "center_lat = \(.lat)\ncenter_lon = \(.lon)\nlocked_radar = \"KTLX\""' engine/data/sites.json > "$scratch/home.toml"
bash scripts/cargo.sh build --offline --locked --quiet
target/debug/omastorm-engine ensure
sock="$XDG_RUNTIME_DIR/omastorm/engine.sock"
tell() { printf '%s\n' "$@" | socat -t0.3 - "UNIX-CONNECT:$sock" > /dev/null; }
tell '{"type":"select_site","id":"KTLX"}' '{"type":"lock","enabled":false}'

capture() { # name, delay ms, ipc steps...
  local name=$1 delay=$2 pid
  shift 2
  OMASTORM_CONFIG="$scratch/home.toml" OMASTORM_WIDTH=960 OMASTORM_HEIGHT=680 \
    OMASTORM_CAPTURE_DELAY="$delay" OMASTORM_CAPTURE="$review/picker-$name.png" bash run.sh > /dev/null 2>&1 &
  pid=$!
  for _ in {1..100}; do quickshell ipc --pid "$pid" call picker status > /dev/null 2>&1 && break; sleep .1; done
  sleep 4 # tiles and the replayed cut
  local step words
  for step in "$@"; do
    read -ra words <<< "$step"
    quickshell ipc --pid "$pid" call picker "${words[@]}"
  done
  wait "$pid"
  [[ -s "$review/picker-$name.png" ]] || { echo "No capture for $name" >&2; exit 1; }
  echo "captured $name · engine on $(timeout 2 socat -t0.2 - "UNIX-CONNECT:$sock" < /dev/null | sed -n 2p | grep -o '"site":{"id"[^}]*}')"
}
capture open 7000 'open tul'
capture chosen 12000 'open tul' accept
tell '{"type":"lock","enabled":false}'

cd "$review"
magick montage -label '%t' picker-open.png picker-chosen.png \
  -tile 2x -geometry 960x680+8+12 -background '#181414' -fill '#e6d9db' -pointsize 18 picker-sheet.png
echo "review/picker-sheet.png"
