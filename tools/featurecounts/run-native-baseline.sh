#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${SUBREAD_SOURCE_DIR:-$PROJECT_ROOT/.w2-cache/sources/subread-2.1.1}"
BIN="$SOURCE_DIR/src/featureCounts"
SAM_DIR="$PROJECT_ROOT/test-data/hisat2/native"
GTF="$PROJECT_ROOT/test-data/hisat2/inputs/annotation.gtf"
GFF3="$PROJECT_ROOT/test-data/featurecounts/inputs/annotation.gff3"
OUT="$PROJECT_ROOT/test-data/featurecounts/native"

"$PROJECT_ROOT/tools/featurecounts/build-native.sh"
mkdir -p "$OUT"
"$BIN" -T 1 -s 0 -t exon -g gene_id -a "$GTF" -o "$OUT/se.counts.txt" "$SAM_DIR/se.sam" > "$OUT/se.stdout.txt" 2> "$OUT/se.stderr.txt"
"$BIN" -T 1 -s 0 -p --countReadPairs -t exon -g gene_id -a "$GTF" -o "$OUT/pe.counts.txt" "$SAM_DIR/pe.sam" > "$OUT/pe.stdout.txt" 2> "$OUT/pe.stderr.txt"
"$BIN" -T 1 -s 0 -t exon -g gene_id -a "$GFF3" -o "$OUT/gff3.counts.txt" "$SAM_DIR/se.sam" > "$OUT/gff3.stdout.txt" 2> "$OUT/gff3.stderr.txt"
printf '0\n' > "$OUT/se.exit-code.txt"
printf '0\n' > "$OUT/pe.exit-code.txt"
printf '0\n' > "$OUT/gff3.exit-code.txt"
sha256sum "$OUT"/*.counts.txt "$OUT"/*.counts.txt.summary
