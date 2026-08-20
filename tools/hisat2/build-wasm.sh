#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${HISAT2_SOURCE_DIR:-$PROJECT_ROOT/.w2-cache/sources/hisat2-v2.2.3}"
EMSDK_DIR="${HISAT2_EMSDK_DIR:-/home/kouta/.local/share/kallisto-web-toolchains/emsdk}"
EXPECTED_COMMIT="0d244324f98de541bce04d45c75e83bc3522f7f4"
EXPECTED_EMSCRIPTEN="6.0.6"
BUILD_PARENT="$PROJECT_ROOT/.w2-cache/build"
DIST_DIR="$PROJECT_ROOT/tools/hisat2/dist"

"$PROJECT_ROOT/tools/hisat2/fetch-source.sh"
if [[ ! -f "$EMSDK_DIR/emsdk_env.sh" ]]; then
  echo "ERROR: emsdk not found at $EMSDK_DIR" >&2
  exit 2
fi
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null
emcc_version="$(emcc --version | head -n 1)"
[[ "$emcc_version" == *" $EXPECTED_EMSCRIPTEN "* ]]
[[ "$(git -C "$SOURCE_DIR" rev-parse HEAD)" == "$EXPECTED_COMMIT" ]]

mkdir -p "$BUILD_PARENT" "$DIST_DIR"
BUILD_DIR="$(mktemp -d "$BUILD_PARENT/hisat2-wasm.XXXXXXXX")"
cleanup() {
  case "$BUILD_DIR" in
    "$BUILD_PARENT"/hisat2-wasm.*) rm -rf -- "$BUILD_DIR" ;;
    *) echo "Refusing to remove unexpected build path: $BUILD_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

git -C "$SOURCE_DIR" archive "$EXPECTED_COMMIT" | tar -x -C "$BUILD_DIR"
python3 "$PROJECT_ROOT/tools/hisat2/patches/apply-wasm-port.py" "$BUILD_DIR"
export SOURCE_DATE_EPOCH=1723593600

emmake make -C "$BUILD_DIR" -j2 hisat2-align-s-wasm \
  CXX=em++ CPP=em++ BITS=wasm BOWTIE_MM=0 EXTRA_FLAGS="-std=c++11" \
  RELEASE_FLAGS="-O3 -g2 -msimd128 -msse2 -funroll-loops -pthread -ffile-prefix-map=$BUILD_DIR=/src/hisat2 -fdebug-prefix-map=$BUILD_DIR=/src/hisat2 -sASSERTIONS=2 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createHisat2Module -sENVIRONMENT=worker,node -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=268435456 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=16777216 -sPTHREAD_POOL_SIZE=4 -sEXPORTED_RUNTIME_METHODS=FS,WORKERFS,callMain -lworkerfs.js"

cp "$BUILD_DIR/hisat2.mjs" "$DIST_DIR/hisat2.mjs"
cp "$BUILD_DIR/hisat2.wasm" "$DIST_DIR/hisat2.wasm"
(cd "$DIST_DIR" && sha256sum hisat2.mjs hisat2.wasm > SHA256SUMS)
echo "$emcc_version"
echo "HISAT2-Wasm built in $DIST_DIR"
