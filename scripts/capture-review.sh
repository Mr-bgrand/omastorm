#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p review
export OMASTORM_ARCHIVE=${OMASTORM_ARCHIVE:-$PWD/data/raw/KTLX20130520_201643_V06.gz} # the archived scan the checks assume
export QT_QPA_PLATFORM=offscreen QT_QPA_PLATFORMTHEME=basic
export QT_QUICK_BACKEND=rhi QSG_RHI_BACKEND=opengl
scratch=$(mktemp -d /tmp/omastorm-review.XXXXXX)
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
for spec in 'minimum 360 360 PIXELS' 'compact 400 420 PIXELS' 'quarter 960 680 PIXELS' 'half 960 1200 PIXELS' 'full 1920 1200 PIXELS' 'glyphs 960 680 GLYPHS' 'stipple 960 680 STIPPLE'; do
  read -r name width height treatment <<< "$spec"
  OMASTORM_WIDTH="$width" OMASTORM_HEIGHT="$height" OMASTORM_STYLE="$treatment" OMASTORM_CAPTURE="$PWD/review/$name.png" bash run.sh
done

# Change only temporary inputs while the SAME Quickshell instance runs.
review_theme_dir="$scratch/theme"
mkdir -p "$review_theme_dir"
printf 'background = "#1a1b26"\nforeground = "#a9b1d6"\naccent = "#7aa2f7"\n' > "$review_theme_dir/colors.toml"
OMASTORM_THEME_DIR="$review_theme_dir" OMASTORM_WIDTH=960 OMASTORM_HEIGHT=680 OMASTORM_CAPTURE_DELAY=5500 OMASTORM_CAPTURE="$PWD/review/theme-change.png" bash run.sh &
review_capture_pid=$!
sleep 1
printf 'background = "#f5f1e8"\nforeground = "#343a48"\naccent = "#365ba8"\n' > "$review_theme_dir/colors.toml"
wait "$review_capture_pid"
# Pixel checks use ImageMagick so the capture review needs no Python.
corner=$(magick review/theme-change.png -format '%[pixel:p{0,0}]' info:)
[[ "$corner" == *'(245,241,232'* ]] || { echo "Theme change not applied: corner is $corner" >&2; exit 1; }
# Crop to the map so legend swatches cannot stand in for the radar: the shader
# must paint the socket palette (band 2, 0-10 dBZ, the most common return).
histogram=$(magick review/theme-change.png -crop 900x430+20+120 +repage -define histogram:unique-colors=true -format %c histogram:info:-)
grep -q '(66,107,136' <<< "$histogram" || { echo 'Radar palette color missing from the map after theme change' >&2; exit 1; }
echo 'Live theme change and fixed radar palette: PASS'
