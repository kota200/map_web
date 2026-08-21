#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$HERE/.." && pwd)"
SRC="${KALLISTO_SOURCE:-$APP_ROOT/vendor/kallisto}"
BUILD_DIR="${KALLISTO_BUILD_DIR:-$APP_ROOT/.wasm-build-debug-noasan}"
OUT_DIR="$APP_ROOT/kallisto"

echo "============================================================"
echo "kallisto WebAssembly v8 DEBUG-NOASAN build"
echo "Memory64 + 8 MiB stacks + checkpoints + UBSan; NO ASan"
echo "============================================================"

if ! command -v emcmake >/dev/null 2>&1 || ! command -v em++ >/dev/null 2>&1; then
  echo "Activate emsdk first: source ~/emsdk/emsdk_env.sh" >&2
  exit 2
fi

bash "$HERE/prepare-clean-source.sh" "$SRC"
python3 "$HERE/patch_kallisto_for_wasm.py" "$SRC"
python3 "$HERE/patch_checkpoints_only.py" "$SRC"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$OUT_DIR"

COMMON_FLAGS="-sMEMORY64=1 -O0 -g3 -fno-omit-frame-pointer -fsanitize=undefined"
LINK_FLAGS="$COMMON_FLAGS -gsource-map -sASSERTIONS=2 -sSTACK_OVERFLOW_CHECK=2 -sSTACK_SIZE=8388608 -sDEFAULT_PTHREAD_STACK_SIZE=8388608"

emcmake cmake -S "$SRC" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_C_FLAGS="$COMMON_FLAGS" \
  -DCMAKE_CXX_FLAGS="$COMMON_FLAGS" \
  -DCMAKE_EXE_LINKER_FLAGS="$LINK_FLAGS" \
  -DUSE_HDF5=OFF -DUSE_BAM=OFF -DENABLE_AVX2=OFF -DCOMPILATION_ARCH=OFF \
  -DBUILD_TESTING=OFF -DBUILD_FUNCTESTING=OFF -DMAX_KMER_SIZE=32

LINK_TXT="$BUILD_DIR/src/CMakeFiles/kallisto.dir/link.txt"
[[ -f "$LINK_TXT" ]] || { echo "ERROR: missing link.txt" >&2; exit 4; }
if grep -q -- '-fsanitize=address' "$LINK_TXT"; then
  echo "ERROR: ASan leaked into DEBUG-NOASAN build." >&2
  exit 4
fi
for flag in '-sMEMORY64=1' '-fsanitize=undefined' '-sSTACK_SIZE=8388608' '-sDEFAULT_PTHREAD_STACK_SIZE=8388608'; do
  grep -q -- "$flag" "$LINK_TXT" || { echo "ERROR: missing flag $flag" >&2; exit 4; }
done

echo "Verified DEBUG-NOASAN link flags. Building..."
cmake --build "$BUILD_DIR" --target kallisto -j "${BUILD_JOBS:-2}"

JS_SOURCE="$(find "$BUILD_DIR/src" -maxdepth 1 -type f -name 'kallisto*.js' ! -name '*worker*' | head -n1 || true)"
WASM_SOURCE="$(find "$BUILD_DIR/src" -maxdepth 1 -type f -name 'kallisto*.wasm' | head -n1 || true)"
[[ -n "$JS_SOURCE" && -n "$WASM_SOURCE" ]] || { echo "ERROR: generated files not found" >&2; exit 3; }
rm -f "$OUT_DIR"/kallisto.js "$OUT_DIR"/kallisto.wasm "$OUT_DIR"/*.wasm.map "$OUT_DIR"/*.symbols "$OUT_DIR"/*worker*.js "$OUT_DIR"/*worker*.mjs
cp "$JS_SOURCE" "$OUT_DIR/kallisto.js"
cp "$WASM_SOURCE" "$OUT_DIR/kallisto.wasm"
find "$BUILD_DIR/src" -maxdepth 1 -type f \( -name '*.wasm.map' -o -name '*.map' -o -name '*.symbols' -o -name '*worker*.js' -o -name '*worker*.mjs' \) -exec cp {} "$OUT_DIR/" \;
cat > "$OUT_DIR/build-info.txt" <<'INFO'
mode=debug-noasan-v8
memory64=1
stack_size=8388608
default_pthread_stack_size=8388608
asan=0
ubsan=1
INFO

echo "DEBUG-NOASAN build complete:"
ls -lh "$OUT_DIR/kallisto.js" "$OUT_DIR/kallisto.wasm"
