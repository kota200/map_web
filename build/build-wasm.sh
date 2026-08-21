#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$HERE/.." && pwd)"
KALLISTO_VERSION="${KALLISTO_VERSION:-v0.52.0}"
SRC="${KALLISTO_SOURCE:-$APP_ROOT/vendor/kallisto}"
BUILD_DIR="${KALLISTO_BUILD_DIR:-$APP_ROOT/.wasm-build}"
OUT_DIR="$APP_ROOT/kallisto"

# v10.4 batch/performance profile. Keep ABI flags global, but do NOT
# globally vectorize/LTO Bifrost or kallisto index serialization/deserialization.
# SIMD/LTO are applied selectively to quantification hot paths and zlib-ng.
WASM_COMMON_FLAGS="-sMEMORY64=1 -O3 -pthread"
WASM_LINK_FLAGS="$WASM_COMMON_FLAGS -flto -msimd128"

cat <<'MSG'
============================================================
kallisto WebAssembly v10.4-batch RELEASE build
native Memory64 + 8 MiB stacks
-O3 + LTO + WebAssembly SIMD128
vendored zlib-ng (generic Wasm build; zlib-compatible API)
NO ASan / NO UBSan
============================================================
MSG
echo

if ! command -v emcmake >/dev/null 2>&1 || ! command -v em++ >/dev/null 2>&1; then
  cat >&2 <<'MSG'
Emscripten SDK is not active.
Activate emsdk first, for example:
  source ~/emsdk/emsdk_env.sh
Then rerun:
  bash build/build-wasm.sh
MSG
  exit 2
fi

# The release ZIP intentionally does not contain kallisto's .git directory.
# If a copied/extracted vendor/kallisto tree exists without .git, replace it
# with a fresh authoritative checkout instead of failing later.
if [[ -e "$SRC" && ! -d "$SRC/.git" ]]; then
  echo "Existing kallisto source is not a Git checkout; replacing it with a fresh $KALLISTO_VERSION checkout..."
  rm -rf "$SRC"
fi

if [[ ! -d "$SRC/.git" ]]; then
  if ! command -v git >/dev/null 2>&1; then
    echo "git is required to fetch kallisto source." >&2
    exit 2
  fi
  mkdir -p "$(dirname "$SRC")"
  echo "Fetching kallisto $KALLISTO_VERSION..."
  git clone --depth 1 --branch "$KALLISTO_VERSION" https://github.com/pachterlab/kallisto.git "$SRC"
fi

if [[ ! -f "$SRC/CMakeLists.txt" ]]; then
  echo "ERROR: fetched kallisto checkout is incomplete: $SRC" >&2
  exit 2
fi

bash "$HERE/prepare-clean-source.sh" "$SRC"
python3 "$HERE/patch_kallisto_for_wasm.py" "$SRC"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$OUT_DIR"

emcmake cmake -S "$SRC" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS="$WASM_COMMON_FLAGS" \
  -DCMAKE_CXX_FLAGS="$WASM_COMMON_FLAGS" \
  -DCMAKE_EXE_LINKER_FLAGS="$WASM_LINK_FLAGS" \
  -DUSE_HDF5=OFF \
  -DUSE_BAM=OFF \
  -DZLIBNG=ON \
  -DZLIB_COMPAT=ON \
  -DZLIB_ENABLE_TESTS=OFF \
  -DWITH_GZFILEOP=ON \
  -DWITH_NATIVE_INSTRUCTIONS=OFF \
  -DWITH_SANITIZER=OFF \
  -DWITH_AVX2=OFF \
  -DWITH_AVX512=OFF \
  -DWITH_AVX512VNNI=OFF \
  -DWITH_SSE2=OFF \
  -DWITH_SSSE3=OFF \
  -DWITH_SSE41=OFF \
  -DWITH_SSE42=OFF \
  -DWITH_PCLMULQDQ=OFF \
  -DWITH_VPCLMULQDQ=OFF \
  -DBUILD_SHARED_LIBS=OFF \
  -DENABLE_AVX2=OFF \
  -DCOMPILATION_ARCH=OFF \
  -DBUILD_TESTING=OFF \
  -DBUILD_FUNCTESTING=OFF \
  -DMAX_KMER_SIZE=32

LINK_TXT="$BUILD_DIR/src/CMakeFiles/kallisto.dir/link.txt"
if [[ ! -f "$LINK_TXT" ]]; then
  echo "ERROR: kallisto link command was not generated." >&2
  exit 4
fi

# ABI / safety checks retained from v8.
if ! grep -q -- '-sMEMORY64=1' "$LINK_TXT"; then
  echo "ERROR: native MEMORY64=1 was not propagated to the kallisto link command." >&2
  exit 4
fi
if grep -q -- '-sMEMORY64=2' "$LINK_TXT"; then
  echo "ERROR: stale MEMORY64=2 detected in kallisto link command." >&2
  exit 4
fi
if ! grep -q -- '-sMAXIMUM_MEMORY=3221225472' "$LINK_TXT"; then
  echo "ERROR: the 3 GiB WebAssembly memory safety ceiling is missing." >&2
  exit 4
fi
if grep -Eq -- '-fsanitize=address|-fsanitize=undefined' "$LINK_TXT"; then
  echo "ERROR: sanitizer flags leaked into RELEASE build." >&2
  exit 4
fi
for flag in '-sSTACK_SIZE=8388608' '-sDEFAULT_PTHREAD_STACK_SIZE=8388608'; do
  if ! grep -q -- "$flag" "$LINK_TXT"; then
    echo "ERROR: required 8 MiB stack flag missing from RELEASE link command: $flag" >&2
    exit 4
  fi
done

# v10 optimization checks.
for flag in '-flto' '-msimd128'; do
  if ! grep -q -- "$flag" "$LINK_TXT"; then
    echo "ERROR: v10 optimization flag missing from link command: $flag" >&2
    exit 4
  fi
done
if grep -q -- '-sUSE_ZLIB=1' "$LINK_TXT"; then
  echo "ERROR: stock Emscripten zlib is still linked; v10 must use vendored zlib-ng." >&2
  exit 4
fi
if ! grep -Eq -- 'zlib-ng/.+libz\.a|zlib-ng/libz\.a' "$LINK_TXT"; then
  echo "ERROR: zlib-ng static library was not found in the kallisto link command." >&2
  echo "Link command:" >&2
  cat "$LINK_TXT" >&2
  exit 4
fi
if [[ -f "$BUILD_DIR/CMakeCache.txt" ]] && ! grep -q '^ZLIB_COMPAT:BOOL=ON' "$BUILD_DIR/CMakeCache.txt"; then
  echo "ERROR: zlib-ng was not configured in zlib-compatible mode." >&2
  exit 4
fi

# zlib-ng 2.1.0 predates Wasm architecture detection.  Never allow its
# x86 CPUID/AVX/SSE implementation files into an Emscripten build.
if grep -R -q -- 'arch/x86/' "$BUILD_DIR/zlib-ng/CMakeFiles" 2>/dev/null; then
  echo "ERROR: zlib-ng selected x86 sources in a WebAssembly build." >&2
  echo "The v10.1 generic-Wasm architecture override did not take effect." >&2
  grep -R -- 'arch/x86/' "$BUILD_DIR/zlib-ng/CMakeFiles" 2>/dev/null | head -n 20 >&2 || true
  exit 4
fi
if [[ -f "$BUILD_DIR/CMakeCache.txt" ]] && ! grep -q '^WITH_SANITIZER:STRING=OFF' "$BUILD_DIR/CMakeCache.txt"; then
  echo "ERROR: zlib-ng sanitizer mode is not OFF." >&2
  exit 4
fi

echo "Verified v10.4-batch configuration: MEMORY64=1, 3 GiB ceiling, 8 MiB stacks, selective LTO/SIMD, generic-Wasm zlib-ng, serial index deserialization, no sanitizers/x86 sources."

cmake --build "$BUILD_DIR" --target kallisto -j "${BUILD_JOBS:-2}"

JS_SOURCE="$(find "$BUILD_DIR/src" -maxdepth 1 -type f -name 'kallisto*.js' ! -name '*worker*' | head -n 1 || true)"
if [[ -z "$JS_SOURCE" ]]; then
  echo "Could not locate generated kallisto.js" >&2
  find "$BUILD_DIR" -maxdepth 3 -type f -name 'kallisto*' -print >&2 || true
  exit 3
fi
rm -f "$OUT_DIR"/kallisto.js "$OUT_DIR"/kallisto.wasm "$OUT_DIR"/*.wasm.map "$OUT_DIR"/*.symbols "$OUT_DIR"/*worker*.js "$OUT_DIR"/*worker*.mjs
cp "$JS_SOURCE" "$OUT_DIR/kallisto.js"

python3 - "$JS_SOURCE" <<'PYMEM'
import re, sys
text = open(sys.argv[1], encoding='utf-8').read()
pat = r'''["']?address["']?\s*:\s*["']i64["']'''
if not re.search(pat, text):
    raise SystemExit('ERROR: generated kallisto.js is not native Memory64 (address: i64 missing).')
print('Verified generated JS glue: WebAssembly.Memory address=i64.')
PYMEM

WASM_SOURCE="$(find "$BUILD_DIR/src" -maxdepth 1 -type f -name 'kallisto*.wasm' | head -n 1 || true)"
if [[ -z "$WASM_SOURCE" ]]; then
  echo "Could not locate generated kallisto.wasm" >&2
  exit 3
fi
cp "$WASM_SOURCE" "$OUT_DIR/kallisto.wasm"

find "$BUILD_DIR/src" -maxdepth 1 -type f \( -name '*worker*.js' -o -name '*worker*.mjs' \) -exec cp {} "$OUT_DIR/" \;

cat > "$OUT_DIR/build-info.txt" <<'INFO'
mode=release-v10.4-batch
kallisto_version=0.52.0
memory64=1
maximum_memory=3221225472
stack_size=8388608
default_pthread_stack_size=8388608
pthread_pool_size=9
optimization=O3
lto=selective_quant_hotpath_and_zlibng
wasm_simd128=selective_quant_hotpath_and_zlibng
compression=zlib-ng
zlib_compat=1
read_batch_bytes_threads_1_to_4=33554432
read_batch_bytes_threads_5_to_8=16777216
gzip_buffer_bytes=1048576
asan=0
ubsan=0
INFO

echo
echo "WASM build complete (v10.4-batch RELEASE):"
ls -lh "$OUT_DIR"/kallisto.js "$OUT_DIR"/kallisto.wasm
echo "Build metadata: $OUT_DIR/build-info.txt"
