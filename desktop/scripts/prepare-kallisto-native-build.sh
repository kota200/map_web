#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:?usage: prepare-kallisto-native-build.sh SOURCE_DIR}"
expected_revision='4e9f29cf3b021260415430c057a22469ca081391'

test "$(git -C "$source_dir" rev-parse HEAD)" = "$expected_revision"
cmake_file="$source_dir/CMakeLists.txt"
test -f "$cmake_file"

# CMake 4 no longer enables pre-3.5 policies implicitly. Propagate the same
# explicit compatibility floor used by the top-level configure into Kallisto's
# two nested ExternalProject configure commands. The source snapshot remains
# the exact upstream commit; CI archives this generated patch beside it.
sed -i.bak \
  's#${DO_ENABLE_AVX2} ${DO_ENABLE_COMPILATION_ARCH}$#${DO_ENABLE_AVX2} ${DO_ENABLE_COMPILATION_ARCH} -DCMAKE_POLICY_VERSION_MINIMUM=3.5#' \
  "$cmake_file"
sed -i.bak \
  's#-DCMAKE_INSTALL_PREFIX=${PREFIX}$#-DCMAKE_INSTALL_PREFIX=${PREFIX} -DCMAKE_POLICY_VERSION_MINIMUM=3.5#' \
  "$cmake_file"
rm -f "$cmake_file.bak"

grep -Fq '${DO_ENABLE_COMPILATION_ARCH} -DCMAKE_POLICY_VERSION_MINIMUM=3.5' "$cmake_file"
grep -Fq '${PREFIX} -DCMAKE_POLICY_VERSION_MINIMUM=3.5' "$cmake_file"
git -C "$source_dir" diff --check
git -C "$source_dir" diff --binary > "$source_dir/kallisto-native-cmake.patch"
test -s "$source_dir/kallisto-native-cmake.patch"
