#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${HISAT2_SOURCE_DIR:-$PROJECT_ROOT/.w2-cache/sources/hisat2-v2.2.3}"
REPOSITORY="https://github.com/DaehwanKimLab/hisat2.git"
EXPECTED_COMMIT="0d244324f98de541bce04d45c75e83bc3522f7f4"

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  mkdir -p "$(dirname "$SOURCE_DIR")"
  git clone --filter=blob:none --no-checkout "$REPOSITORY" "$SOURCE_DIR"
fi

if ! git -C "$SOURCE_DIR" cat-file -e "$EXPECTED_COMMIT^{commit}" 2>/dev/null; then
  git -C "$SOURCE_DIR" fetch --depth=1 origin "$EXPECTED_COMMIT"
fi
git -C "$SOURCE_DIR" checkout --detach "$EXPECTED_COMMIT"

actual_commit="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
[[ "$actual_commit" == "$EXPECTED_COMMIT" ]]
[[ "$(cat "$SOURCE_DIR/VERSION")" == "2.2.3" ]]
git -C "$SOURCE_DIR" diff --quiet -- .
echo "HISAT2 source verified: $actual_commit"
