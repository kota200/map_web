#!/usr/bin/env bash
set -euo pipefail
SRC=${1:?usage: prepare-clean-source.sh /path/to/kallisto}
if [[ ! -d "$SRC/.git" ]]; then
  echo "ERROR: kallisto source is not a Git checkout: $SRC" >&2
  echo "build/build-wasm.sh should normally replace such a tree automatically." >&2
  exit 2
fi
HEAD_BEFORE=$(git -C "$SRC" rev-parse --short HEAD)
echo "Resetting kallisto source to clean upstream checkout ($HEAD_BEFORE)..."
git -C "$SRC" reset --hard HEAD >/dev/null
git -C "$SRC" clean -fdx >/dev/null
echo "Clean source ready."
