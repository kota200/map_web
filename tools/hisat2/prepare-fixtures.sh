#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${HISAT2_SOURCE_DIR:-$PROJECT_ROOT/.w2-cache/sources/hisat2-v2.2.3}"
INPUT_DIR="$PROJECT_ROOT/test-data/hisat2/inputs"
OUTPUT_DIR="$PROJECT_ROOT/test-data/hisat2/native"

"$PROJECT_ROOT/tools/hisat2/build-native.sh"
mkdir -p "$OUTPUT_DIR/index"
python3 "$SOURCE_DIR/hisat2_extract_splice_sites.py" "$INPUT_DIR/annotation.gtf" > "$OUTPUT_DIR/splice-sites.txt"
python3 "$SOURCE_DIR/hisat2_extract_exons.py" "$INPUT_DIR/annotation.gtf" > "$OUTPUT_DIR/exons.txt"
"$SOURCE_DIR/hisat2-build-s" \
  --ss "$OUTPUT_DIR/splice-sites.txt" \
  --exon "$OUTPUT_DIR/exons.txt" \
  "$INPUT_DIR/genome.fa" "$OUTPUT_DIR/index/tiny" \
  > "$OUTPUT_DIR/build.stdout.txt" 2> "$OUTPUT_DIR/build.stderr.txt"
(cd "$OUTPUT_DIR/index" && sha256sum tiny.{1..8}.ht2 > SHA256SUMS)
echo "HISAT2 native fixture index generated in $OUTPUT_DIR/index"
