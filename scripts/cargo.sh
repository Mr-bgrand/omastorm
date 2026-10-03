#!/usr/bin/env bash
# Prefer an installed toolchain; also support an isolated checkout-local one.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v cargo >/dev/null && [[ -x .tools/cargo/bin/cargo ]]; then
  export RUSTUP_HOME="$PWD/.tools/rustup" CARGO_HOME="$PWD/.tools/cargo"
  export PATH="$CARGO_HOME/bin:$PATH"
fi
# Integration isolates XDG paths and blocks live providers. A mise cargo shim
# would look for tools in that scratch home and try installing them again.
# Resolve rustup's installed toolchain without downloading, including rustc.
rustup_bin="${CARGO_HOME:-$HOME/.cargo}/bin/rustup"
if [[ ! -x "$rustup_bin" ]]; then
  rustup_bin=$(command -v rustup || true)
fi
if [[ -n "$rustup_bin" ]]; then
  cargo_bin=$("$rustup_bin" which cargo)
  export PATH="${cargo_bin%/*}:$PATH"
  exec "$cargo_bin" "$@"
fi
exec cargo "$@"
