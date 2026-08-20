#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${FASTP_SOURCE_DIR:-$PROJECT_ROOT/.w2-cache/sources/fastp-v0.23.4}"
EMSDK_DIR="${FASTP_EMSDK_DIR:-/home/kouta/.local/share/kallisto-web-toolchains/emsdk}"
EXPECTED_FASTP_COMMIT="1ffcaed6892832c09c4b4094c201cd4eff8fa622"
EXPECTED_EMSCRIPTEN="6.0.6"
BUILD_PARENT="$PROJECT_ROOT/.w2-cache/build"
DIST_DIR="$PROJECT_ROOT/tools/fastp/dist"

"$PROJECT_ROOT/tools/fastp/fetch-source.sh"

if [[ ! -f "$EMSDK_DIR/emsdk_env.sh" ]]; then
  echo "ERROR: emsdk not found at $EMSDK_DIR" >&2
  echo "Install and activate Emscripten $EXPECTED_EMSCRIPTEN or set FASTP_EMSDK_DIR." >&2
  exit 2
fi

# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null
emcc_version="$(emcc --version | head -n 1)"
if [[ "$emcc_version" != *" $EXPECTED_EMSCRIPTEN "* ]]; then
  echo "ERROR: expected Emscripten $EXPECTED_EMSCRIPTEN, got: $emcc_version" >&2
  exit 3
fi

actual_commit="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
[[ "$actual_commit" == "$EXPECTED_FASTP_COMMIT" ]]

mkdir -p "$BUILD_PARENT" "$DIST_DIR"
BUILD_DIR="$(mktemp -d "$BUILD_PARENT/fastp-wasm.XXXXXXXX")"
cleanup() {
  case "$BUILD_DIR" in
    "$BUILD_PARENT"/fastp-wasm.*) rm -rf -- "$BUILD_DIR" ;;
    *) echo "Refusing to remove unexpected build path: $BUILD_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

git -C "$SOURCE_DIR" archive "$EXPECTED_FASTP_COMMIT" | tar -x -C "$BUILD_DIR"
python3 "$PROJECT_ROOT/tools/fastp/patches/apply-wasm-port.py" "$BUILD_DIR"

mapfile -t sources < <(find "$BUILD_DIR/src" -maxdepth 1 -type f -name '*.cpp' -print | sort)

em++ \
  -std=c++11 \
  -pthread \
  -O3 \
  -g2 \
  -ffile-prefix-map="$BUILD_DIR"=/src/fastp \
  -fdebug-prefix-map="$BUILD_DIR"=/src/fastp \
  -I"$BUILD_DIR/src" \
  "${sources[@]}" \
  -sUSE_ZLIB=1 \
  -sASSERTIONS=2 \
  -sENVIRONMENT=worker,node \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createFastpModule \
  -sINVOKE_RUN=0 \
  -sEXIT_RUNTIME=1 \
  -sFILESYSTEM=1 \
  -sFORCE_FILESYSTEM=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=268435456 \
  -sMAXIMUM_MEMORY=2147483648 \
  -sSTACK_SIZE=8388608 \
  -sPTHREAD_POOL_SIZE=8 \
  "-sEXPORTED_RUNTIME_METHODS=['FS','WORKERFS','callMain']" \
  -lworkerfs.js \
  -o "$BUILD_DIR/fastp.mjs"

cp "$BUILD_DIR/fastp.mjs" "$DIST_DIR/fastp.mjs"
cp "$BUILD_DIR/fastp.wasm" "$DIST_DIR/fastp.wasm"
for worker in "$BUILD_DIR"/fastp.worker.*; do
  [[ -f "$worker" ]] || continue
  cp "$worker" "$DIST_DIR/$(basename "$worker")"
done

(
  cd "$DIST_DIR"
  sha256sum fastp.mjs fastp.wasm > SHA256SUMS
)

echo "$emcc_version"
echo "fastp-Wasm built in $DIST_DIR"
