#!/usr/bin/env bash
# Shared native QML composition; binary/scratch/daemon ownership is in suite.py.
stage_ui() {
  mkdir -p "$1"
  cp -a ui/. "$1/"
}

# These are condition polls. Elapsed time never makes a check pass.
wait_window_ready() {
  for _ in {1..100}; do
    [[ $(quickshell ipc --pid "$1" call locationTest ready 2>/dev/null) == true ]] && return
    sleep .1
  done
  return 1
}

wait_saved_view() { # file, lat, lon, span (IPC precision)
  for _ in {1..100}; do
    if jq -e --argjson lat "$2" --argjson lon "$3" --argjson span "$4" \
      '((.lat * 1000 + 0.5 | floor) / 1000) == $lat
       and ((.lon * 1000 + 0.5 | floor) / 1000) == $lon
       and ((.span * 10 + 0.5 | floor) / 10) == $span' \
      "$1" > /dev/null 2>&1; then return; fi
    sleep .1
  done
  return 1
}
