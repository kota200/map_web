#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${FASTP_SOURCE_DIR:-$PROJECT_ROOT/.w2-cache/sources/fastp-v0.23.4}"
DEPS_ROOT="$PROJECT_ROOT/.w2-cache/native-deps/root"
OUTPUT_DIR="$PROJECT_ROOT/.w2-cache/build/fastp-native-v0.23.4"
EXPECTED_COMMIT="1ffcaed6892832c09c4b4094c201cd4eff8fa622"

"$PROJECT_ROOT/tools/fastp/fetch-source.sh"
"$PROJECT_ROOT/tools/fastp/prepare-native-deps.sh"

actual_commit="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
[[ "$actual_commit" == "$EXPECTED_COMMIT" ]]

mkdir -p "$OUTPUT_DIR"
mapfile -t sources < <(find "$SOURCE_DIR/src" -maxdepth 1 -type f -name '*.cpp' -print | sort)

g++ \
  -std=c++11 \
  -pthread \
  -O3 \
  -I"$SOURCE_DIR/src" \
  -I"$DEPS_ROOT/usr/include" \
  "${sources[@]}" \
  -L"$DEPS_ROOT/usr/lib/x86_64-linux-gnu" \
  -Wl,-rpath,"$DEPS_ROOT/usr/lib/x86_64-linux-gnu" \
  -lisal \
  -ldeflate \
  -lpthread \
  -o "$OUTPUT_DIR/fastp"

"$OUTPUT_DIR/fastp" --version
sha256sum "$OUTPUT_DIR/fastp" > "$OUTPUT_DIR/SHA256SUMS"
echo "Native fastp built at $OUTPUT_DIR/fastp"
