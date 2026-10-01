#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
scope=all
gpu=()
for arg in "$@"; do
  case $arg in
    all|engine|protocol|ui|installer|rendering) scope=$arg ;;
    --gpu) gpu=(--gpu) ;;
    --prebuilt) ;;
    *) echo "Usage: check.sh [scope] [--gpu]" >&2; exit 2 ;;
  esac
done
exec python3 scripts/tooling/cli.py check --scope "$scope" "${gpu[@]}"
