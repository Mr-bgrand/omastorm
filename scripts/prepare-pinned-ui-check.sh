#!/usr/bin/env bash
# Assemble a disposable UI tree with a verified pin or supplied CI candidate.
# Existing UI checks use target/debug and run.sh invokes cargo build. In this
# tree only, build is a no-op so those checks cannot replace the supplied binary.
set -euo pipefail
cd "$(dirname "$0")/.."
dest=${1:?Usage: prepare-pinned-ui-check.sh destination [candidate-binary]}
candidate=${2:-}
mkdir -p "$dest/target/debug"
# Copy working-tree edits, including new files before their first commit.
git ls-files --cached --others --exclude-standard -z | tar --null -T - -cf - | tar -xf - -C "$dest"
mkdir -p "$dest/data/raw"
cp -a data/raw/. "$dest/data/raw/"
if [[ -n $candidate ]]; then
  binary=$(realpath "$candidate")
else
  binary=$(XDG_DATA_HOME="$dest/target/pinned-data" bash scripts/fetch-engine.sh --print-path)
  # The installer regression check reuses these exact verified bytes.
  hash=$(sha256sum "$binary" | awk '{print $1}')
  install -D -m 755 "$binary" "$dest/target/pinned/$hash"
fi
cp "$binary" "$dest/target/debug/omastorm-engine"
cat > "$dest/scripts/cargo.sh" <<'CARGO'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == 'build --offline --locked --quiet' ]]; then exit 0; fi
echo "Unexpected Cargo invocation in published-engine UI checks: $*" >&2
exit 1
CARGO
