#!/usr/bin/env bash
# Shared native QML composition; binary/scratch/daemon ownership is in suite.py.
stage_ui() {
  mkdir -p "$1"
  cp -a ui/. "$1/"
}
