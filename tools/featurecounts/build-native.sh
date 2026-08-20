#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${SUBREAD_SOURCE_DIR:-$PROJECT_ROOT/.w2-cache/sources/subread-2.1.1}"
"$PROJECT_ROOT/tools/featurecounts/fetch-source.sh"
make -C "$SOURCE_DIR/src" -f Makefile.Linux -j2 featureCounts
"$SOURCE_DIR/src/featureCounts" -v
sha256sum "$SOURCE_DIR/src/featureCounts"
