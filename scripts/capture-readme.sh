#!/usr/bin/env bash
# Presentation stills for the README: the archived Moore/KTLX volume with
# live chrome (no ARCHIVED badge), Tokyo Night and Flexoki Light. Isolated
# daemons; no login plugin. OpenGL RHI required.
set -euo pipefail
cd "$(dirname "$0")/.."
media="$PWD/docs/media/readme"
mkdir -p "$media" review
scratch=$(mktemp -d /tmp/omastorm-readme.XXXXXX)
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
mkdir -p "$scratch/runtime" "$scratch/cache" "$scratch/bin" "$scratch/tokyo-night" "$scratch/flexoki-light"
export XDG_RUNTIME_DIR="$scratch/runtime" XDG_CACHE_HOME="$scratch/cache" TMPDIR="$scratch"
export QT_QPA_PLATFORM=offscreen QT_QPA_PLATFORMTHEME=basic QT_QUICK_BACKEND=rhi QSG_RHI_BACKEND=opengl
export OMASTORM_ARCHIVE=${OMASTORM_ARCHIVE:-$PWD/data/raw/KTLX20130520_201643_V06.gz}
unset OMASTORM_RESCAN_PLUGIN
jq -r '.sites[] | select(.id=="KTLX") | "center_lat = \(.lat)\ncenter_lon = \(.lon)\nlocked_radar = \"KTLX\""' engine/data/sites.json > "$scratch/ktlx.toml"
: > "$scratch/none.toml"
: > "$scratch/empty-state.json"
cat > "$scratch/bin/curl" <<'EOF'
#!/bin/bash
exit 22
EOF
chmod +x "$scratch/bin/curl"

# Omarchy Tokyo Night / Flexoki Light, inlined so capture does not need the
# theme pack installed.
cat > "$scratch/tokyo-night/colors.toml" <<'EOF'
mode = "dark"
accent = "#7aa2f7"
background = "#1a1b26"
foreground = "#a9b1d6"
yellow = "#e0af68"
red = "#f7768e"
EOF
cat > "$scratch/flexoki-light/colors.toml" <<'EOF'
mode = "light"
accent = "#205EA6"
background = "#FFFCF0"
foreground = "#100F0F"
yellow = "#D0A215"
red = "#D14D41"
EOF

bash scripts/cargo.sh build --offline --locked --quiet
harness=$(bash scripts/capture-harness.sh)
harness_dir=$(dirname "$harness")
cp ui/PopoverHarness.qml ui/Popover.qml ui/Panel.qml ui/Metar.js "$harness_dir/"
perl -pi -e 's/color: "#181414"/color: theme.snapshot.background/' "$harness_dir/PopoverHarness.qml"
export OMASTORM_QML="$harness"
export OMASTORM_STATE_OVERRIDE='{"source":"live","connection":{"status":"ok","ageSeconds":48}}'
export OMASTORM_THEME_DIR="$scratch/tokyo-night"

wait_ipc() {
  local pid=$1
  for _ in {1..120}; do
    quickshell ipc --pid "$pid" call keys status >/dev/null 2>&1 && return 0
    sleep .1
  done
  echo "keys IPC never answered (pid $pid)" >&2
  return 1
}

grab() {
  local name=$1 delay=$2 pid
  shift 2
  local env_args=() steps=()
  while [[ $# -gt 0 ]]; do
    if [[ $1 == -- ]]; then shift; steps=("$@"); break; fi
    env_args+=("$1"); shift
  done
  local path="$media/$name.png"
  rm -f "$path"
  local extra=() a has_config=0
  for a in "${env_args[@]+"${env_args[@]}"}"; do
    [[ $a == OMASTORM_CONFIG=* ]] && has_config=1
  done
  (( has_config )) || extra+=(OMASTORM_CONFIG="$scratch/ktlx.toml")
  env "${env_args[@]+"${env_args[@]}"}" "${extra[@]}" \
    OMASTORM_WIDTH=640 OMASTORM_HEIGHT=480 \
    OMASTORM_CAPTURE_DELAY="$delay" OMASTORM_CAPTURE="$path" \
    bash run.sh > "$scratch/$name.log" 2>&1 &
  pid=$!
  wait_ipc "$pid" || { cat "$scratch/$name.log"; kill "$pid" 2>/dev/null || true; return 1; }
  local step words
  for step in "${steps[@]+"${steps[@]}"}"; do
    read -ra words <<< "$step"
    case ${words[0]} in
      sleep) sleep "${words[1]}" ;;
      wait-matches)
        local needle=${words[1]} m
        for _ in {1..50}; do
          m=$(quickshell ipc --pid "$pid" call location matches 2>/dev/null || true)
          [[ $m == *"$needle"* ]] && break
          sleep .1
        done
        ;;
      locate)
        quickshell ipc --pid "$pid" call keys run locate
        ;;
      location)
        if [[ ${words[1]} == open ]]; then
          quickshell ipc --pid "$pid" call location open "${step#location open }"
        else
          quickshell ipc --pid "$pid" call location "${words[1]}"
        fi
        ;;
      *) quickshell ipc --pid "$pid" call "${words[@]}" ;;
    esac
  done
  wait "$pid" || true
  [[ -s $path ]] || { cat "$scratch/$name.log"; echo "No capture for $name" >&2; exit 1; }
  echo "captured $name"
}

grab_popover() {
  local raw="$scratch/popover-raw.png"
  rm -f "$raw" "$media/popover.png"
  target/debug/omastorm-engine ensure
  env OMASTORM_CONFIG="$scratch/ktlx.toml" OMASTORM_LOCATION=/dev/null \
    OMASTORM_STATE="$scratch/empty-state.json" \
    quickshell -p "$harness_dir/PopoverHarness.qml" > "$scratch/popover.log" 2>&1 &
  local pid=$!
  local ready=0 status
  for _ in {1..120}; do
    status=$(quickshell ipc --pid "$pid" call popover status 2>/dev/null || true)
    if [[ -n $status ]] && jq -e '.site == "KTLX" and (.frame | contains("loading") | not)' >/dev/null 2>&1 <<<"$status"; then
      ready=1
      break
    fi
    sleep .5
  done
  if [[ $ready != 1 ]]; then
    cat "$scratch/popover.log"
    echo "Popover never showed KTLX (last: ${status:-none})" >&2
    kill "$pid" 2>/dev/null || true
    exit 1
  fi
  sleep 1.5
  quickshell ipc --pid "$pid" call popover capture "$raw"
  for _ in {1..50}; do [[ -s $raw ]] && break; sleep .1; done
  quickshell ipc --pid "$pid" call popover quit >/dev/null 2>&1 || true
  wait "$pid" 2>/dev/null || true
  [[ -s $raw ]] || { cat "$scratch/popover.log"; echo "No popover capture" >&2; exit 1; }
  magick "$raw" -crop 336x400+22+42 +repage "$media/popover.png"
  echo "captured popover"
}

grab window 4000 OMASTORM_STYLE=GLYPHS
grab window-light 4000 OMASTORM_STYLE=GLYPHS OMASTORM_THEME_DIR="$scratch/flexoki-light"
grab_popover

magick -background '#1a1b26' \
  \( "$media/window.png" \) \
  \( "$media/popover.png" -resize x480 \) \
  +smush 20 \
  -bordercolor '#1a1b26' -border 18 \
  "$media/hero.png"
echo "captured hero"

magick montage -label 'Tokyo Night' "$media/window.png" -label 'Flexoki Light' "$media/window-light.png" \
  -tile 2x -geometry 640x480+10+16 -background '#1a1b26' -fill '#a9b1d6' -pointsize 15 \
  "$media/themes.png"
echo "captured themes"

grab pixels 4000 OMASTORM_STYLE=PIXELS
grab glyphs 4000 OMASTORM_STYLE=GLYPHS
grab stipple 4000 OMASTORM_STYLE=STIPPLE
magick montage -label '%t' "$media/pixels.png" "$media/glyphs.png" "$media/stipple.png" \
  -tile 3x -geometry 320x240+6+10 -background '#1a1b26' -fill '#a9b1d6' -pointsize 14 \
  "$media/treatments.png"
rm -f "$media/pixels.png" "$media/glyphs.png" "$media/stipple.png"
echo "captured treatments"

grab onboard 5000 \
  OMASTORM_CONFIG="$scratch/none.toml" \
  OMASTORM_STATE="$scratch/empty-state.json" \
  OMASTORM_LOCATION=/dev/null \
  -- 'sleep 1' 'location prompt'

grab search-city 7000 -- 'sleep 2' 'location open tulsa' 'wait-matches Tulsa'
grab search-site 5000 -- 'sleep 2' 'location open ktlx'
grab search-coords 6000 -- 'sleep 2' 'location open 35.4, -97.5'
grab search-error 6000 -- 'sleep 2' 'location open 95, -97.5'

PATH="$scratch/bin:$PATH" OMASTORM_LOCATION_URL='http://127.0.0.1:1/nope' \
  grab locate-fail 6000 -- 'sleep 2' locate

echo "$media"
