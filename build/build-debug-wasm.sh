#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$HERE/.." && pwd)"
KALLISTO_VERSION="${KALLISTO_VERSION:-v0.52.0}"
SRC="${KALLISTO_SOURCE:-$APP_ROOT/vendor/kallisto}"
BUILD_DIR="${KALLISTO_BUILD_DIR:-$APP_ROOT/.wasm-build-debug}"
OUT_DIR="$APP_ROOT/kallisto"

echo "============================================================"
echo "kallisto WebAssembly v7 DEBUG build (8 MiB stack fix)"
echo "native Memory64 + pthreads + ASan + UBSan + source maps + 8 MiB stacks"
echo "============================================================"
echo

if ! command -v emcmake >/dev/null 2>&1 || ! command -v em++ >/dev/null 2>&1; then
  cat >&2 <<'MSG'
Emscripten SDK is not active.
Run, for example:
  source ~/emsdk/emsdk_env.sh
Then rerun:
  bash build/build-debug-wasm.sh
MSG
  exit 2
fi

if [[ ! -f "$SRC/CMakeLists.txt" ]]; then
  mkdir -p "$(dirname "$SRC")"
  echo "Fetching kallisto $KALLISTO_VERSION..."
  git clone --depth 1 --branch "$KALLISTO_VERSION" https://github.com/pachterlab/kallisto.git "$SRC"
fi

# Base browser portability patch, then debug instrumentation.
bash "$HERE/prepare-clean-source.sh" "$SRC"
python3 "$HERE/patch_kallisto_for_wasm.py" "$SRC"
python3 "$HERE/patch_debug_instrumentation.py" "$SRC"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$OUT_DIR"

# We keep Memory64=1 because Bifrost stores 64-bit packed IDs in size_t.
# Sanitizers are deliberately present in compile AND link flags.
COMMON_DEBUG_FLAGS="-sMEMORY64=1 -O0 -g3 -fno-omit-frame-pointer -fsanitize=address -fsanitize=undefined"
LINK_DEBUG_FLAGS="$COMMON_DEBUG_FLAGS -gsource-map -sASSERTIONS=2 -sSTACK_OVERFLOW_CHECK=2 -sSTACK_SIZE=8388608 -sDEFAULT_PTHREAD_STACK_SIZE=8388608"

emcmake cmake -S "$SRC" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_C_FLAGS="$COMMON_DEBUG_FLAGS" \
  -DCMAKE_CXX_FLAGS="$COMMON_DEBUG_FLAGS" \
  -DCMAKE_EXE_LINKER_FLAGS="$LINK_DEBUG_FLAGS" \
  -DUSE_HDF5=OFF \
  -DUSE_BAM=OFF \
  -DENABLE_AVX2=OFF \
  -DCOMPILATION_ARCH=OFF \
  -DBUILD_TESTING=OFF \
  -DBUILD_FUNCTESTING=OFF \
  -DMAX_KMER_SIZE=32

LINK_TXT="$BUILD_DIR/src/CMakeFiles/kallisto.dir/link.txt"
if [[ ! -f "$LINK_TXT" ]]; then
  echo "ERROR: expected link.txt not found: $LINK_TXT" >&2
  exit 4
fi
for flag in '-sMEMORY64=1' '-fsanitize=address' '-fsanitize=undefined' '-gsource-map' '-sSTACK_SIZE=8388608' '-sDEFAULT_PTHREAD_STACK_SIZE=8388608'; do
  if ! grep -q -- "$flag" "$LINK_TXT"; then
    echo "ERROR: required debug link flag missing: $flag" >&2
    exit 4
  fi
done
if grep -q -- '-sMEMORY64=2' "$LINK_TXT"; then
  echo "ERROR: stale MEMORY64=2 detected." >&2
  exit 4
fi

echo "Verified debug link flags. Building..."
cmake --build "$BUILD_DIR" --target kallisto -j "${BUILD_JOBS:-2}"

JS_SOURCE="$(find "$BUILD_DIR/src" -maxdepth 1 -type f -name 'kallisto*.js' ! -name '*worker*' | head -n 1 || true)"
WASM_SOURCE="$(find "$BUILD_DIR/src" -maxdepth 1 -type f -name 'kallisto*.wasm' | head -n 1 || true)"
if [[ -z "$JS_SOURCE" || -z "$WASM_SOURCE" ]]; then
  echo "ERROR: generated kallisto.js/kallisto.wasm not found." >&2
  exit 3
fi

cp "$JS_SOURCE" "$OUT_DIR/kallisto.js"
cp "$WASM_SOURCE" "$OUT_DIR/kallisto.wasm"

# Native Memory64 sanity check.
python3 - "$JS_SOURCE" <<'PYMEM'
import re, sys
text = open(sys.argv[1], encoding='utf-8').read()
if not re.search(r'''["']?address["']?\s*:\s*["']i64["']''', text):
    raise SystemExit('ERROR: generated JS glue is not native Memory64 (address:i64 missing).')
print('Verified native Memory64 JS glue (address=i64).')
PYMEM

# Copy source maps / symbol maps and pthread helpers when emitted.
find "$BUILD_DIR/src" -maxdepth 1 -type f \( \
    -name '*.wasm.map' -o -name '*.map' -o -name '*.symbols' -o \
    -name '*worker*.js' -o -name '*worker*.mjs' \
  \) -exec cp {} "$OUT_DIR/" \;

echo
echo "DEBUG WASM build complete:"
ls -lh "$OUT_DIR/kallisto.js" "$OUT_DIR/kallisto.wasm"
find "$OUT_DIR" -maxdepth 1 -type f \( -name '*.map' -o -name '*.symbols' \) -print | sed 's/^/debug artifact: /' || true

echo
echo "Next:"
echo "  python3 build/serve.py"
echo "Then open http://127.0.0.1:8000/ and run test-data/transcripts.fa with Threads=1."
echo "If it still fails, copy the complete [WASM DEBUG], AddressSanitizer, UBSan, or stack-overflow output back to ChatGPT."
