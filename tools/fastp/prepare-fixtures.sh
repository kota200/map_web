#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INPUT_DIR="$PROJECT_ROOT/test-data/fastp/inputs"

for input in \
  "$INPUT_DIR/se.fastq" \
  "$INPUT_DIR/pe.R1.fastq" \
  "$INPUT_DIR/pe.R2.fastq" \
  "$INPUT_DIR/malformed.fastq"; do
  gzip --no-name --keep --force "$input"
done

sha256sum "$INPUT_DIR"/*.fastq "$INPUT_DIR"/*.fastq.gz > "$INPUT_DIR/SHA256SUMS"
echo "Deterministic gzip fixtures prepared in $INPUT_DIR"
