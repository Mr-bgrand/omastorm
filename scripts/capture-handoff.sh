#!/usr/bin/env bash
# Site navigation (DESIGN.md, site navigation as built): one pan across the
# network from Oklahoma City to Jacksonville as a capture series, following
# and then locked, as review/handoff-*.png and review/handoff-sheet.png.
#
# Each capture is a fresh window on the shared daemon with its camera
# started at a point along the pan (OMASTORM_VIEW, 500 km across). The
# settle sends view_center and the daemon hands off for real, so the
# following row goes live station by station over the network (the loading
# view, or the replayed cut once it has painted), while the locked row keeps
# the station it was locked on as the camera leaves it behind. The daemon is
# left following on the last station.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p review
export OMASTORM_ARCHIVE=${OMASTORM_ARCHIVE:-$PWD/data/raw/KTLX20130520_201643_V06.gz} # the archived scan the checks assume
export QT_QPA_PLATFORM=offscreen QT_QPA_PLATFORMTHEME=basic QT_QUICK_BACKEND=rhi QSG_RHI_BACKEND=opengl
review="$PWD/review"
rm -f "$review"/handoff-*.png
scratch=$(mktemp -d /tmp/omastorm-handoff.XXXXXX)
cleanup() {
  jobs -pr > "$scratch/.jobs"
  xargs -r kill -KILL < "$scratch/.jobs" 2>/dev/null || true
  wait || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
: > "$scratch/none.toml" # no home site: the camera alone picks the station
bash scripts/cargo.sh build --offline --locked --quiet
target/debug/omastorm-engine ensure
sock="$XDG_RUNTIME_DIR/omastorm/engine.sock"
tell() { printf '%s\n' "$@" | socat -t0.3 - "UNIX-CONNECT:$sock" > /dev/null; }
# The pan: latitude, longitude, and the station the engine should hand off to.
positions=('35.468 -97.333 KTLX' '35.30 -95.00 KSRX' '34.90 -92.30 KLZK' '33.20 -87.00 KBMX' '31.00 -84.30 KTLH' '30.50 -81.90 KJAX')

capture() { # name, delay ms, lat, lon
  local name=$1 delay=$2 lat=$3 lon=$4
  OMASTORM_CONFIG="$scratch/none.toml" OMASTORM_VIEW="$lat,$lon,500" OMASTORM_WIDTH=960 OMASTORM_HEIGHT=680 \
    OMASTORM_CAPTURE_DELAY="$delay" OMASTORM_CAPTURE="$review/handoff-$name.png" bash run.sh > /dev/null 2>&1
  [[ -s "$review/handoff-$name.png" ]] || { echo "No capture for $name" >&2; exit 1; }
  echo "captured $name · engine on $(timeout 2 socat -t0.2 - "UNIX-CONNECT:$sock" < /dev/null | sed -n 2p | grep -o '"site":{"id"[^}]*}')"
}

tell '{"type":"select_site","id":"KTLX"}' '{"type":"lock","enabled":false}' '{"type":"follow","enabled":true}'
i=0
for position in "${positions[@]}"; do
  read -r lat lon expected <<< "$position"
  i=$((i + 1))
  capture "following-$i-$expected" 9000 "$lat" "$lon"
done
tell '{"type":"select_site","id":"KTLX"}' '{"type":"lock","enabled":true}'
i=0
for position in "${positions[@]}"; do
  read -r lat lon expected <<< "$position"
  i=$((i + 1))
  capture "locked-$i-$expected" 3500 "$lat" "$lon"
done
tell '{"type":"lock","enabled":false}'

cd "$review"
magick montage -label '%t' handoff-following-*.png handoff-locked-*.png \
  -tile 6x -geometry 640x453+8+12 -background '#181414' -fill '#e6d9db' -pointsize 18 handoff-sheet.png
echo "review/handoff-sheet.png"
