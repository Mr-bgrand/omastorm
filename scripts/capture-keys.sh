#!/usr/bin/env bash
# The keyboard session (DESIGN.md, keyboard map as built) as three captures
# over the quarter window on the shared daemon: the `?` sheet open over live
# KTLX, the treatment menu open from the chip, and the header naming the
# current-location home from a weather.json for Stokesdale, NC (KFCX)
# (review/keys-help.png, review/keys-chip.png, review/keys-home.png, and
# review/keys-sheet.png side by side). The daemon is left on KTLX, unlocked.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p review
export OMASTORM_ARCHIVE=${OMASTORM_ARCHIVE:-$PWD/data/raw/KTLX20130520_201643_V06.gz} # the archived scan the checks assume
export QT_QPA_PLATFORM=offscreen QT_QPA_PLATFORMTHEME=basic QT_QUICK_BACKEND=rhi QSG_RHI_BACKEND=opengl
review="$PWD/review"
rm -f "$review"/keys-*.png
scratch=$(mktemp -d /tmp/omastorm-keys.XXXXXX)
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
: > "$scratch/none.toml"
printf '{\n  "name": "Stokesdale",\n  "latitude": 36.23708,\n  "longitude": -79.97948\n}\n' > "$scratch/weather.json"
bash scripts/cargo.sh build --offline --locked --quiet
target/debug/omastorm-engine ensure
sock="$XDG_RUNTIME_DIR/omastorm/engine.sock"
tell() { printf '%s\n' "$@" | socat -t0.3 - "UNIX-CONNECT:$sock" > /dev/null; }
tell '{"type":"select_site","id":"KTLX"}' '{"type":"lock","enabled":false}'

capture() { # name, delay ms, config, location, ipc steps...
  local name=$1 delay=$2 config=$3 location=$4 pid
  shift 4
  OMASTORM_CONFIG="$config" OMASTORM_LOCATION="$location" OMASTORM_STATE="$scratch/state-$name.json" OMASTORM_WIDTH=960 OMASTORM_HEIGHT=680 \
    OMASTORM_CAPTURE_DELAY="$delay" OMASTORM_CAPTURE="$review/keys-$name.png" bash run.sh > /dev/null 2>&1 &
  pid=$!
  for _ in {1..100}; do quickshell ipc --pid "$pid" call keys status > /dev/null 2>&1 && break; sleep .1; done
  sleep 4 # tiles and the replayed cut
  local step words
  for step in "$@"; do
    read -ra words <<< "$step"
    quickshell ipc --pid "$pid" call keys "${words[@]}"
  done
  wait "$pid"
  [[ -s "$review/keys-$name.png" ]] || { echo "No capture for $name" >&2; exit 1; }
  echo "captured $name · engine on $(timeout 2 socat -t0.2 - "UNIX-CONNECT:$sock" < /dev/null | sed -n 2p | grep -o '"site":{"id"[^}]*}')"
}
capture help 7000 "$scratch/home.toml" "$scratch/missing.json" 'run help'
capture chip 7000 "$scratch/home.toml" "$scratch/missing.json" 'menu true'
capture home 12000 "$scratch/none.toml" "$scratch/weather.json"
tell '{"type":"select_site","id":"KTLX"}' '{"type":"lock","enabled":false}'

cd "$review"
magick montage -label '%t' keys-help.png keys-chip.png keys-home.png \
  -tile 3x -geometry 960x680+8+12 -background '#181414' -fill '#e6d9db' -pointsize 18 keys-sheet.png
echo "review/keys-sheet.png"
