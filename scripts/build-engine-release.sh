#!/usr/bin/env bash
# Internal CI operation: build one optimized native asset and its metadata.
# Does not publish, tag, or push.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { printf '%s\n' "$@" >&2; exit 1; }
[[ $# == 0 ]] || die "Usage: bash scripts/build-engine-release.sh"

if ! command -v rustc >/dev/null && [[ -x .tools/cargo/bin/rustc ]]; then
  export RUSTUP_HOME="$PWD/.tools/rustup" CARGO_HOME="$PWD/.tools/cargo"
  export PATH="$CARGO_HOME/bin:$PATH"
fi
host=$(rustc -vV | awk '/^host:/{print $2}')
case $host in
  x86_64-unknown-linux-gnu|aarch64-unknown-linux-gnu) ;;
  *) die "Build on x86_64-unknown-linux-gnu or aarch64-unknown-linux-gnu (host is $host)." ;;
esac
# Explicit target avoids a Cargo config/env target silently changing the asset.
bash scripts/cargo.sh build --release --target "$host" --locked --offline
src=target/$host/release/omastorm-engine
[[ -x $src ]] || die "cargo did not produce $src"

mkdir -p target/dist
asset=omastorm-engine-$host
dest=target/dist/$asset
cp -- "$src" "$dest"
strip --strip-unneeded -- "$dest"
chmod 755 -- "$dest"
sum=$(sha256sum -- "$dest" | awk '{print $1}')
printf '%s  %s\n' "$sum" "$dest"

version=$(awk -F'"' '/^version = /{print $2; exit}' engine/Cargo.toml)
jq -n --arg source "$(git rev-parse HEAD)" --arg version "$version" \
  --arg asset "$asset" --arg sha256 "$sum" \
  '{source:$source, version:$version, asset:$asset, sha256:$sha256}' > "$dest.build.json"
printf 'Native build: %s (tracked pin unchanged).\n' "$dest"
