#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARCHIVE="$PROJECT_ROOT/.w2-cache/downloads/subread-2.1.1-source.tar.gz"
SOURCE_DIR="${SUBREAD_SOURCE_DIR:-$PROJECT_ROOT/.w2-cache/sources/subread-2.1.1}"
SOURCE_URL="https://downloads.sourceforge.net/project/subread/subread-2.1.1/subread-2.1.1-source.tar.gz"
EXPECTED_SHA256="6392d7c66831cdd767e58251892a79a51b6fab8ed0ba9671ad5e85ff1ab01eaa"

mkdir -p "$(dirname "$ARCHIVE")" "$(dirname "$SOURCE_DIR")"
if [[ ! -f "$ARCHIVE" ]]; then
  curl -L --fail --retry 3 -o "$ARCHIVE" "$SOURCE_URL"
fi
echo "$EXPECTED_SHA256  $ARCHIVE" | sha256sum -c -

if [[ ! -f "$SOURCE_DIR/src/makefile.version" ]]; then
  mkdir -p "$SOURCE_DIR"
  tar -xzf "$ARCHIVE" --strip-components=1 -C "$SOURCE_DIR"
fi
[[ "$(sed -n 's/^SUBREAD_VERSION_BASE=//p' "$SOURCE_DIR/src/makefile.version")" == '2.1.1' ]]
echo "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903  $SOURCE_DIR/LICENSE" | sha256sum -c -
echo "ad98043b854208135b5a2c29fda298bb6f5c635e96cd5cd309c6b51c0eb09934  $SOURCE_DIR/src/Makefile.Linux" | sha256sum -c -
echo "Subread 2.1.1 source archive verified."
