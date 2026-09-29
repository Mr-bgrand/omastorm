#!/usr/bin/env bash
# A station waiting for its first sweep (DESIGN.md, lean startup as built):
# review/loading-before.png is a scratch daemon with an empty cache the moment
# it goes live on SITE (default KJAX), the map without radar under LOADING;
# review/loading-after.png is the same daemon once the current volume's
# lowest cut has been replayed from the bucket. review/loading-none.png is a
# lean daemon with no configured centre: the first-run location picker.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p review
export QT_QPA_PLATFORM=offscreen QT_QPA_PLATFORMTHEME=basic QT_QUICK_BACKEND=rhi QSG_RHI_BACKEND=opengl
site="${SITE:-KJAX}"
review="$PWD/review"
rm -f "$review"/loading-*.png
scratch=$(mktemp -d /tmp/omastorm-loading.XXXXXX)
cleanup() {
  jobs -pr > "$scratch/.jobs"
  xargs -r kill -KILL < "$scratch/.jobs" 2>/dev/null || true
  wait || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
config="$scratch/config.toml"
jq -r --arg id "$site" '.sites[] | select(.id==$id) | "center_lat = \(.lat)\ncenter_lon = \(.lon)\nlocked_radar = \"\(.id)\""' engine/data/sites.json > "$config"
none="$scratch/none.toml"
: > "$none"

capture() { # name, delay ms, env...
  local name=$1 delay=$2
  shift 2
  env "$@" OMASTORM_WIDTH=960 OMASTORM_HEIGHT=680 OMASTORM_CAPTURE_DELAY="$delay" OMASTORM_CAPTURE="$review/loading-$name.png" bash run.sh > /dev/null 2>&1
  [[ -s "$review/loading-$name.png" ]] || { echo "No capture for $name" >&2; exit 1; }
  echo "captured $name"
}

# The scratch daemon never touches the shared daemon's runtime directory or
# the real cache; ensure in run.sh finds it by build under XDG_RUNTIME_DIR.
mkdir -p "$scratch/runtime" "$scratch/cache"
XDG_RUNTIME_DIR="$scratch/runtime" XDG_CACHE_HOME="$scratch/cache" OMASTORM_ARCHIVE='' target/debug/omastorm-engine serve > "$scratch/engine.log" 2>&1 &
for _ in $(seq 100); do [[ -S "$scratch/runtime/omastorm/engine.sock" ]] && break; sleep .1; done
[[ -S "$scratch/runtime/omastorm/engine.sock" ]] || { echo "Scratch daemon did not start" >&2; cat "$scratch/engine.log" >&2; exit 1; }
capture none 2500 XDG_RUNTIME_DIR="$scratch/runtime" XDG_CACHE_HOME="$scratch/cache" OMASTORM_CONFIG="$none"
capture before 1500 XDG_RUNTIME_DIR="$scratch/runtime" XDG_CACHE_HOME="$scratch/cache" OMASTORM_CONFIG="$config"
capture after 20000 XDG_RUNTIME_DIR="$scratch/runtime" XDG_CACHE_HOME="$scratch/cache" OMASTORM_CONFIG="$config"
grep -h "^Live\|^Ready" "$scratch/engine.log" | sed 's/^/  engine: /' | head -4
jobs -p | xargs -r kill 2>/dev/null || true

cd "$review"
magick montage -label '%t' loading-none.png loading-before.png loading-after.png \
  -tile 3x -geometry 960x680+10+14 -background '#181414' -fill '#e6d9db' -pointsize 22 loading-sheet.png
echo "review/loading-sheet.png"
