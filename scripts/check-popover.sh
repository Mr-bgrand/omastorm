#!/usr/bin/env bash
# Real card + embedded window, isolated from the desktop shell and daemon.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p review
scratch=$PWD/target/check-popover
rm -rf "$scratch"
mkdir -p "$scratch"
export XDG_RUNTIME_DIR="$scratch/r" XDG_CACHE_HOME="$scratch/cache"
export QT_QPA_PLATFORM=offscreen QT_QPA_PLATFORMTHEME=basic QT_QUICK_BACKEND=rhi QSG_RHI_BACKEND=opengl
export OMASTORM_CONFIG="$scratch/config.toml"
export OMASTORM_STATE="$scratch/state.json"
# A scratch plugin root, so the update notice can be driven by rewriting its
# manifest; run.sh there hands off to this checkout's.
export OMASTORM_ROOT="$scratch/root"
mkdir -p "$XDG_RUNTIME_DIR" "$OMASTORM_ROOT"
cp manifest.json "$OMASTORM_ROOT/manifest.json"
printf '#!/usr/bin/env bash\nexec bash %q "$@"\n' "$PWD/run.sh" > "$OMASTORM_ROOT/run.sh"
manifest_version() { jq -r .version manifest.json; }
set_manifest_version() { # version: replaced whole, as a git fast-forward does
  jq --arg v "$1" '.version = $v' manifest.json > "$OMASTORM_ROOT/manifest.next"
  mv "$OMASTORM_ROOT/manifest.next" "$OMASTORM_ROOT/manifest.json"
}
# Station selection starts live polling. Keep the seeded timeline
# deterministic by refusing HTTP fetches in this isolated check process.
export http_proxy=http://127.0.0.1:9
export https_proxy=$http_proxy HTTP_PROXY=$http_proxy HTTPS_PROXY=$http_proxy
export all_proxy=$http_proxy ALL_PROXY=$http_proxy no_proxy='' NO_PROXY=''
: > "$OMASTORM_CONFIG"
jq -c '.sites[] | select(.id=="KTLX") | {lat, lon, span: 210}' engine/data/sites.json > "$OMASTORM_STATE"
pid=
cleanup() {
  [[ -z $pid ]] || kill "$pid" 2>/dev/null || true
  target/debug/omastorm-engine stop >/dev/null 2>&1 || true
  # Runtime files go; UI logs and the disposable harness stay for reading.
  rm -rf "$scratch/r" "$scratch/cache"
}
trap cleanup EXIT
# Instrument disposable copies only: production controls emit their commands,
# but playback tests consume replayed state instead of running engine policy.
cp -a ui "$scratch/ui"
cp tests/popover-playback.js "$scratch/ui/PlaybackTest.js"
python3 - "$scratch/ui" <<'PY_HARNESS'
from pathlib import Path
import sys
root = Path(sys.argv[1])
p = root / 'Engine.qml'
s = p.read_text().replace('    id: engine', '    id: engine\n    property bool testPlayback: false\n    property var testCommands: []', 1)
s = s.replace('    function send(command) {', '    function send(command) {\n        if (testPlayback) { testCommands = testCommands.concat([command]); return; }', 1)
p.write_text(s)
p = root / 'RadarWindow.qml'
p.write_text(p.read_text().replace('    id: app', '    id: app\n    property alias testEngine: engine', 1))
p = root / 'PopoverHarness.qml'
s = p.read_text().replace('import QtQuick', 'import "PlaybackTest.js" as PlaybackTest\nimport QtQuick', 1)
s = s.replace('        function play(): void', '''        function beginPlayback(): void { PlaybackTest.begin(popover.engine, panel.testEngine); }
        function playbackFrame(index: int, playing: bool): void { PlaybackTest.frame(index, playing); }
        function clearPlaybackCommands(): void { PlaybackTest.clearCommands(); }
        function playbackCommands(): string { return PlaybackTest.commands(); }
        function endPlayback(): void { PlaybackTest.end(); }
        function play(): void''', 1)
p.write_text(s)
PY_HARNESS
quickshell -p "$scratch/ui/PopoverHarness.qml" > "$scratch/ui.log" 2>&1 &
pid=$!
call() { quickshell ipc --pid "$pid" call popover "$@"; }
status() { call status; }
fail() { echo "$*" >&2; cat "$scratch/ui.log" >&2; exit 1; }
until_status() {
  local filter=$1
  for _ in {1..100}; do
    status 2>/dev/null | jq -e "$filter" >/dev/null 2>&1 && return 0
    sleep .1
  done
  fail "Timed out: $filter"
}
# A UI control must send exactly its command and wait for engine state.
expect_command() {
  local client=$1 expected=$2
  shift 2
  call clearPlaybackCommands
  "$@"
  call playbackCommands | jq -e --arg client "$client" --argjson expected "$expected" \
    '.[$client] == [$expected]' >/dev/null || fail "Wrong $client command: $(call playbackCommands)"
}
until_status '.site == "KTLX" and .windowSite == "KTLX"'
before=$(status | jq -r .frame)
call expand
until_status '.window and .expanded'
[[ $(status | jq -r .windowFrame) == "$before" ]] || fail 'Expand changed the archived frame'
call treatment STIPPLE
until_status '.treatment == "STIPPLE" and .windowTreatment == "STIPPLE"'
call closeWindow
until_status '.window == false'
call reopen
call expand
until_status '.window and .treatment == "STIPPLE"'
# Archived provenance and timestamp must never turn into a live badge.
until_status '.condition == "archived" and .text == "ARCHIVED"'
call closeWindow
call reopen
call capture "$PWD/review/popover-archived.png"
for _ in {1..50}; do [[ -s review/popover-archived.png ]] && break; sleep .1; done
sock="$XDG_RUNTIME_DIR/omastorm/engine.sock"
tell() { printf '%s\n' "$@" | socat -t0.2 - "UNIX-CONNECT:$sock" >/dev/null; }
# Replay arbitrary frame orders: the UI follows state and never chooses
# the engine's next frame or loop boundary. Engine unit tests own that policy.
call beginPlayback
until_status '.frame == "ui-playback-1" and .windowFrame == "ui-playback-1" and (.playing | not)'
expect_command popover '{"type":"step","delta":1}' call step 1
until_status '.frame == "ui-playback-1" and .windowFrame == "ui-playback-1"'
call playbackFrame 3 false
until_status '.frame == "ui-playback-3" and .windowFrame == "ui-playback-3"'
expect_command popover '{"type":"play"}' call play
until_status '(.playing | not) and (.windowPlaying | not)'
call playbackFrame 0 true
until_status '.frame == "ui-playback-0" and .windowFrame == "ui-playback-0" and .playing and .windowPlaying'
expect_command popover '{"type":"pause"}' call play
until_status '.playing and .windowPlaying'
call playbackFrame 2 false
until_status '.frame == "ui-playback-2" and .windowFrame == "ui-playback-2" and (.playing | not) and (.windowPlaying | not)'
expect_command window '{"type":"seek","id":"ui-playback-0"}' quickshell ipc --pid "$pid" call keys run oldest
call playbackFrame 0 false
until_status '.frame == "ui-playback-0" and .windowFrame == "ui-playback-0"'
expect_command window '{"type":"play"}' quickshell ipc --pid "$pid" call keys run play
for index in 3 1 0; do
  call playbackFrame "$index" true
  until_status ".frame == \"ui-playback-$index\" and .windowFrame == \"ui-playback-$index\" and .playing and .windowPlaying"
done
expect_command window '{"type":"pause"}' quickshell ipc --pid "$pid" call keys run play
call playbackFrame 3 false
until_status '(.playing | not) and (.windowPlaying | not)'
expect_command popover '{"type":"play"}' call play
call playbackFrame 1 true
until_status '.frame == "ui-playback-1" and .windowFrame == "ui-playback-1" and .playing and .windowPlaying'
# Expanding and closing preserve supplied state without sending seek/pause.
call clearPlaybackCommands
call reopen
call expand
until_status '.window and .playing and .windowPlaying and .frame == "ui-playback-1" and .windowFrame == "ui-playback-1"'
call closeWindow
until_status '.window == false and .frame == "ui-playback-1" and .playing'
call playbackCommands | jq -e '.popover == [] and .window == []' >/dev/null \
  || fail 'Expand/close sent a playback command'
call endPlayback
# A configured lock applies immediately; opening and closing the window
# must preserve an explicitly supplied selection.
printf 'locked_radar = "KFCX"\n' > "$OMASTORM_CONFIG"
until_status '.site == "KFCX"'
tell '{"type":"select_site","id":"KTLX"}' '{"type":"lock","enabled":true}'
until_status '.site == "KTLX"'
call reopen
call expand
until_status '.window and .site == "KTLX" and .windowSite == "KTLX"'
call closeWindow
until_status '.window == false and .site == "KTLX"'
# An update on disk that the shell has not loaded: the manifest's version
# moves away from the loaded one and the notice names it; back to the loaded
# version (a rolled-back update) and it goes.
until_status '.updatePending == false and .updateNotice == ""'
set_manifest_version 9.9.9
until_status '.updatePending and .updateNotice == "UPDATED TO 9.9.9 · RESTART THE SHELL"'
set_manifest_version "$(manifest_version)"
until_status '.updatePending == false'
# A stopped daemon followed by ensure must reconnect all surviving clients.
# Reconnect keeps the session lock and camera; this process never unlocked,
# so KFCX is selected again.
target/debug/omastorm-engine stop
until_status '.connected == false'
target/debug/omastorm-engine ensure
until_status '.site == "KFCX" and .connected'
call quit
wait "$pid"
pid=
if rg 'Binding loop|ReferenceError|TypeError|Unable to assign|Failed to load' "$scratch/ui.log"; then fail 'QML runtime errors'; fi
echo 'Popover: archived provenance, expand preservation, treatment sharing, close/reopen, playback, lock, update notice, daemon restart PASS'
