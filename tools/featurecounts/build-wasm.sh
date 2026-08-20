#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARCHIVE="$PROJECT_ROOT/.w2-cache/downloads/subread-2.1.1-source.tar.gz"
EMSDK_DIR="${FEATURECOUNTS_EMSDK_DIR:-/home/kouta/.local/share/kallisto-web-toolchains/emsdk}"
EXPECTED_EMSCRIPTEN="6.0.6"
BUILD_PARENT="$PROJECT_ROOT/.w2-cache/build"
DIST_DIR="$PROJECT_ROOT/tools/featurecounts/dist"

"$PROJECT_ROOT/tools/featurecounts/fetch-source.sh"
if [[ ! -f "$EMSDK_DIR/emsdk_env.sh" ]]; then
  echo "ERROR: emsdk not found at $EMSDK_DIR" >&2
  exit 2
fi
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null
emcc_version="$(emcc --version | head -n 1)"
[[ "$emcc_version" == *" $EXPECTED_EMSCRIPTEN "* ]]

mkdir -p "$BUILD_PARENT" "$DIST_DIR"
BUILD_DIR="$(mktemp -d "$BUILD_PARENT/featurecounts-wasm.XXXXXXXX")"
cleanup() {
  case "$BUILD_DIR" in
    "$BUILD_PARENT"/featurecounts-wasm.*) rm -rf -- "$BUILD_DIR" ;;
    *) echo "Refusing to remove unexpected build path: $BUILD_DIR" >&2 ;;
  esac
}
trap cleanup EXIT
tar -xzf "$ARCHIVE" --strip-components=1 -C "$BUILD_DIR"
python3 "$PROJECT_ROOT/tools/featurecounts/patches/apply-wasm-port.py" "$BUILD_DIR"
export SOURCE_DATE_EPOCH=1723593600

emmake make -C "$BUILD_DIR/src" -f Makefile.Linux -j2 featureCounts \
  CC_EXEC=emcc \
  CCFLAGS="-O3 -g2 -pthread -ffile-prefix-map=$BUILD_DIR=/src/subread -fdebug-prefix-map=$BUILD_DIR=/src/subread -DMAKE_FOR_EXON -DMAKE_STANDALONE -DSUBREAD_VERSION=\\\"2.1.1\\\" -D_FILE_OFFSET_BITS=64" \
  LDFLAGS="-O3 -g2 -pthread -ffile-prefix-map=$BUILD_DIR=/src/subread -fdebug-prefix-map=$BUILD_DIR=/src/subread -sUSE_ZLIB=1 -sASSERTIONS=2 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createFeatureCountsModule -sENVIRONMENT=worker,node -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=134217728 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=8388608 -sPTHREAD_POOL_SIZE=4 -sEXPORTED_RUNTIME_METHODS=FS,WORKERFS,callMain -lworkerfs.js -lm"

cp "$BUILD_DIR/src/featureCounts.mjs" "$DIST_DIR/featureCounts.mjs"
cp "$BUILD_DIR/src/featureCounts.wasm" "$DIST_DIR/featureCounts.wasm"
(cd "$DIST_DIR" && sha256sum featureCounts.mjs featureCounts.wasm > SHA256SUMS)
echo "$emcc_version"
echo "featureCounts-Wasm built in $DIST_DIR"
