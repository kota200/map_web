#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEB_DIR="$PROJECT_ROOT/.w2-cache/native-deps/debs"
DEPS_ROOT="$PROJECT_ROOT/.w2-cache/native-deps/root"

mkdir -p "$DEB_DIR" "$DEPS_ROOT"

download_and_verify() {
  local filename="$1"
  local url="$2"
  local expected_sha="$3"
  local destination="$DEB_DIR/$filename"

  if [[ ! -f "$destination" ]]; then
    curl --fail --location --retry 3 --output "$destination" "$url"
  fi
  printf '%s  %s\n' "$expected_sha" "$destination" | sha256sum --check --status
  dpkg-deb --extract "$destination" "$DEPS_ROOT"
}

download_and_verify \
  "libisal-dev_2.30.0-4_amd64.deb" \
  "https://archive.ubuntu.com/ubuntu/pool/universe/libi/libisal/libisal-dev_2.30.0-4_amd64.deb" \
  "f6f0a7cba41cfe07bf05e34cd6157a7178b2b24550e92df8d225594abfe9d8df"
download_and_verify \
  "libisal2_2.30.0-4_amd64.deb" \
  "https://archive.ubuntu.com/ubuntu/pool/universe/libi/libisal/libisal2_2.30.0-4_amd64.deb" \
  "c4910d7444db48d6ad5210764901577c653685f6a813310039d0c371023272b6"
download_and_verify \
  "libdeflate-dev_1.10-2_amd64.deb" \
  "https://archive.ubuntu.com/ubuntu/pool/main/libd/libdeflate/libdeflate-dev_1.10-2_amd64.deb" \
  "83802a0aa001d4fab55bf02caee8e9241bbdaaf309dfde5137ea105289b1e9f6"
download_and_verify \
  "libdeflate0_1.10-2_amd64.deb" \
  "https://archive.ubuntu.com/ubuntu/pool/main/libd/libdeflate/libdeflate0_1.10-2_amd64.deb" \
  "a64f7f93a487e57e1a01404d378a8ef1428b1c6b0ecf24fc484c89b681a051c9"

echo "Native dependencies extracted to $DEPS_ROOT"
