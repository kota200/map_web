#!/usr/bin/env bash
set -euo pipefail

FASTP_COMMIT="1ffcaed6892832c09c4b4094c201cd4eff8fa622"
FASTP_TAG="v0.23.4"
REPOSITORY="https://github.com/OpenGene/fastp.git"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${FASTP_SOURCE_DIR:-$PROJECT_ROOT/.w2-cache/sources/fastp-v0.23.4}"

mkdir -p "$(dirname "$SOURCE_DIR")"

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  if [[ -e "$SOURCE_DIR" ]]; then
    echo "ERROR: source target exists but is not a Git checkout: $SOURCE_DIR" >&2
    exit 2
  fi
  git clone --depth 1 --branch "$FASTP_TAG" "$REPOSITORY" "$SOURCE_DIR"
fi

actual_commit="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
if [[ "$actual_commit" != "$FASTP_COMMIT" ]]; then
  echo "ERROR: expected fastp $FASTP_COMMIT, found $actual_commit" >&2
  exit 3
fi

if ! git -C "$SOURCE_DIR" diff --ignore-space-at-eol --quiet --exit-code; then
  echo "ERROR: tracked files in the clean source checkout contain content changes." >&2
  exit 4
fi

license_sha="$(git -C "$SOURCE_DIR" show "$FASTP_COMMIT:LICENSE" | sha256sum | awk '{print $1}')"
archive_sha="$(git -C "$SOURCE_DIR" archive --format=tar "$FASTP_COMMIT" | sha256sum | awk '{print $1}')"
echo "fastp tag: $FASTP_TAG"
echo "fastp commit: $actual_commit"
echo "LICENSE SHA-256: $license_sha"
echo "Canonical git archive SHA-256: $archive_sha"
