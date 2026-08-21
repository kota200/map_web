#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:?usage: prepare-kallisto-windows.sh SOURCE_DIR}"
expected_revision='4e9f29cf3b021260415430c057a22469ca081391'

test "$(git -C "$source_dir" rev-parse HEAD)" = "$expected_revision"
test -f "$source_dir/license.txt"
test -f "$source_dir/ext/bifrost/LICENSE"
test -f "$source_dir/ext/zlib-ng/LICENSE.md"

# Kallisto's v0.52.0 tree carries its upstream Windows cross-build recipe in
# .make_binaries.windows.txt. Apply the minimal no-HDF5/no-HTSlib subset here
# with stable searches rather than its line-number-based edits. The resulting
# diff is archived by CI beside the binary and source snapshot.
cat > "$source_dir/ext/bifrost/src/CMakeLists.txt" <<'EOF'
file(GLOB sources *.cpp roaring.c)
file(GLOB headers *.h *.hpp *.hh *.tcc)
list(REMOVE_ITEM sources Bifrost.cpp)
add_definitions(-DMAX_KMER_SIZE=${MAX_KMER_SIZE})
add_definitions(-DMAX_GMER_SIZE=${MAX_GMER_SIZE})
add_library(bifrost_static STATIC ${sources} ${headers})
set_target_properties(bifrost_static PROPERTIES OUTPUT_NAME "bifrost")
target_include_directories(bifrost_static PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
find_package(Threads REQUIRED)
target_link_libraries(bifrost_static PUBLIC Threads::Threads)
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/../../../ext/zlib-ng/zlib-ng)
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/../../../ext/zlib-ng)
target_link_libraries(bifrost_static PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../../../ext/zlib-ng/zlib-ng/libz.a psapi)
add_executable(Bifrost Bifrost.cpp)
target_link_libraries(Bifrost PRIVATE bifrost_static)
install(TARGETS Bifrost DESTINATION bin)
install(TARGETS bifrost_static DESTINATION lib)
install(FILES ${headers} DESTINATION include/bifrost)
EOF

roaring_header="$source_dir/ext/bifrost/src/roaring.h"
roaring_source="$source_dir/ext/bifrost/src/roaring.c"
sed -i \
  's/^inline bool roaring_bitmap_contains(/static inline bool roaring_bitmap_contains(/' \
  "$roaring_header"
sed -i \
  '/^extern inline bool roaring_bitmap_contains(/,/^[[:space:]]*uint32_t val);$/d' \
  "$roaring_source"
grep -Fq 'static inline bool roaring_bitmap_contains(' "$roaring_header"
if grep -Fq 'extern inline bool roaring_bitmap_contains(' "$roaring_source"; then
  echo 'Bifrost still contains the duplicate roaring_bitmap_contains definition' >&2
  exit 1
fi

find "$source_dir/ext/bifrost" -type f \
  \( -name '*.cpp' -o -name '*.c' -o -name '*.h' -o -name '*.hpp' -o -name '*.tcc' \) \
  -exec sed -i 's#<zlib.h>#<zlib-ng/zlib.h>#g; s/max(1UL,/max(static_cast<size_t>(1),/g' {} +

tiny_bitmap="$source_dir/ext/bifrost/src/TinyBitmap.cpp"
sed -i \
  -e 's/free(tiny_bmp);/posix_memalign_free(tiny_bmp);/g' \
  -e 's/free(tiny_bmp_new);/posix_memalign_free(tiny_bmp_new);/g' \
  -e 's/free(new_t_bmp);/posix_memalign_free(new_t_bmp);/g' \
  "$tiny_bitmap"

sed -i 's/libz\.lib/libz.a/g' "$source_dir/src/CMakeLists.txt"
git -C "$source_dir" diff --check
git -C "$source_dir" diff --binary > "$source_dir/kallisto-windows-x64.patch"
test -s "$source_dir/kallisto-windows-x64.patch"
