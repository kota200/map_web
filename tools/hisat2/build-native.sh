#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${HISAT2_SOURCE_DIR:-$PROJECT_ROOT/.w2-cache/sources/hisat2-v2.2.3}"
"$PROJECT_ROOT/tools/hisat2/fetch-source.sh"
make -C "$SOURCE_DIR" -j2 hisat2-align-s hisat2-build-s
sha256sum "$SOURCE_DIR/hisat2-align-s" "$SOURCE_DIR/hisat2-build-s"
