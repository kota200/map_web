#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${HISAT2_SOURCE_DIR:-$PROJECT_ROOT/.w2-cache/sources/hisat2-v2.2.3}"
INPUT_DIR="$PROJECT_ROOT/test-data/hisat2/inputs"
OUTPUT_DIR="$PROJECT_ROOT/test-data/hisat2/native"
INDEX="$OUTPUT_DIR/index/tiny"

"$PROJECT_ROOT/tools/hisat2/prepare-fixtures.sh"
"$SOURCE_DIR/hisat2-align-s" --wrapper basic-0 -x "$INDEX" -p 1 \
  -U "$INPUT_DIR/se.fastq" -S "$OUTPUT_DIR/se.sam" \
  > "$OUTPUT_DIR/se.stdout.txt" 2> "$OUTPUT_DIR/se.stderr.txt"
"$SOURCE_DIR/hisat2-align-s" --wrapper basic-0 -x "$INDEX" -p 1 \
  -1 "$INPUT_DIR/pe_R1.fastq" -2 "$INPUT_DIR/pe_R2.fastq" -S "$OUTPUT_DIR/pe.sam" \
  > "$OUTPUT_DIR/pe.stdout.txt" 2> "$OUTPUT_DIR/pe.stderr.txt"
printf '0\n' > "$OUTPUT_DIR/se.exit-code.txt"
printf '0\n' > "$OUTPUT_DIR/pe.exit-code.txt"
sha256sum "$OUTPUT_DIR/se.sam" "$OUTPUT_DIR/pe.sam"
