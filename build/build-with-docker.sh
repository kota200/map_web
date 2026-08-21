#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$HERE/.." && pwd)"

docker run --rm \
  -v "$APP_ROOT:/src" \
  -w /src \
  emscripten/emsdk:latest \
  bash -lc 'bash build/build-wasm.sh'
