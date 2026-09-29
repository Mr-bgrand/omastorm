#!/usr/bin/env bash
# Location, remembered view, and a locked radar with the camera outside
# coverage (DESIGN.md, location): review/location-*.png and
# review/location-sheet.png.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p review
export OMASTORM_ARCHIVE=${OMASTORM_ARCHIVE:-$PWD/data/raw/KTLX20130520_201643_V06.gz}
export QT_QPA_PLATFORM=offscreen QT_QPA_PLATFORMTHEME=basic QT_QUICK_BACKEND=rhi QSG_RHI_BACKEND=opengl
review="$PWD/review"
rm -f "$review"/location-*.png
scratch=$(mktemp -d /tmp/omastorm-location.XXXXXX)
cleanup() {
  jobs -pr > "$scratch/.jobs"
  xargs -r kill -KILL < "$scratch/.jobs" 2>/dev/null || true
  wait || true
  XDG_RUNTIME_DIR="$scratch/runtime" target/debug/omastorm-engine stop >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export XDG_RUNTIME_DIR="$scratch/runtime" XDG_CACHE_HOME="$scratch/cache"
mkdir -p "$XDG_RUNTIME_DIR" "$XDG_CACHE_HOME"
printf '{\n  "name": "Stokesdale",\n  "latitude": 36.23708,\n  "longitude": -79.97948\n}\n' > "$scratch/weather.json"
: > "$scratch/none.toml"
printf 'center_lat = 30.332\ncenter_lon = -81.656\nlocked_radar = "KTLX"\n' > "$scratch/locked.toml"
bash scripts/cargo.sh build --offline --locked --quiet
target/debug/omastorm-engine ensure

capture() { # name, delay ms, env..., then ipc steps
  local name=$1 delay=$2 pid
  shift 2
  local env_args=() steps=()
  while [[ $# -gt 0 ]]; do
    if [[ $1 == -- ]]; then shift; steps=("$@"); break; fi
    env_args+=("$1"); shift
  done
  env "${env_args[@]}" OMASTORM_WIDTH=960 OMASTORM_HEIGHT=680 \
    OMASTORM_CAPTURE_DELAY="$delay" OMASTORM_CAPTURE="$review/location-$name.png" bash run.sh > /dev/null 2>&1 &
  pid=$!
  for _ in {1..100}; do quickshell ipc --pid "$pid" call keys status > /dev/null 2>&1 && break; sleep .1; done
  sleep 4
  local step words
  for step in "${steps[@]+"${steps[@]}"}"; do
    read -ra words <<< "$step"
    quickshell ipc --pid "$pid" call "${words[@]}"
  done
  wait "$pid"
  [[ -s "$review/location-$name.png" ]] || { echo "No capture for $name" >&2; exit 1; }
  echo "captured $name"
}

capture weather 7000 OMASTORM_CONFIG="$scratch/none.toml" OMASTORM_LOCATION="$scratch/weather.json" OMASTORM_STATE="$scratch/state-weather.json"
capture picker 8000 OMASTORM_CONFIG="$scratch/none.toml" OMASTORM_LOCATION="$scratch/missing.json" OMASTORM_STATE="$scratch/state-picker.json" -- 'location open oklahoma'
capture coords 8000 OMASTORM_CONFIG="$scratch/none.toml" OMASTORM_LOCATION="$scratch/missing.json" OMASTORM_STATE="$scratch/state-coords.json" -- 'location open 35.4, -97.5'
capture locked 8000 OMASTORM_CONFIG="$scratch/locked.toml" OMASTORM_LOCATION="$scratch/missing.json" OMASTORM_STATE="$scratch/state-locked.json"

cd "$review"
magick montage -label '%t' location-weather.png location-picker.png location-coords.png location-locked.png \
  -tile 2x -geometry 640x453+8+12 -background '#181414' -fill '#e6d9db' -pointsize 18 location-sheet.png
echo "review/location-sheet.png"
