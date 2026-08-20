#!/usr/bin/env bash
# Generate the real-data W6 HISAT2 2.2.3 reference and native expected results.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="${W6_DATA_DIR:-$(cd "$ROOT/.." && pwd)/example_data}"
DESTINATION="${W6_HISAT2_OUTPUT_DIR:-$ROOT/tools/w6-validation/representative-hisat2}"
THREADS="${W6_HISAT2_THREADS:-4}"
HISAT2_DIR="${HISAT2_SOURCE_DIR:-$ROOT/.w2-cache/sources/hisat2-v2.2.3}"
FEATURECOUNTS_BIN="${SUBREAD_SOURCE_DIR:-$ROOT/.w2-cache/sources/subread-2.1.1}/src/featureCounts"

for required in "$DATA_DIR/Col-CC_v2_genome.fasta.gz" "$DATA_DIR/TAIR12_1Feb26.gff3.gz" \
  "$DATA_DIR/Unknown_CO100-001U0001_good_1.fq.gz" "$DATA_DIR/Unknown_CO100-001U0001_good_2.fq.gz" \
  "$HISAT2_DIR/hisat2-build-s" "$HISAT2_DIR/hisat2-align-s" "$FEATURECOUNTS_BIN"; do
  [[ -f "$required" ]] || { echo "Missing required input: $required" >&2; exit 2; }
done
[[ ! -e "$DESTINATION" ]] || { echo "Refusing to overwrite existing W6 output: $DESTINATION" >&2; exit 2; }
[[ "$THREADS" =~ ^[1-9][0-9]*$ ]] || { echo "W6_HISAT2_THREADS must be a positive integer." >&2; exit 2; }

parent="$(dirname "$DESTINATION")"
mkdir -p "$parent"
work="$(mktemp -d "$parent/.representative-hisat2.XXXXXXXX")"
completed=false
cleanup() {
  if "$completed"; then
    rm -rf -- "$work"
  elif [[ "${W6_HISAT2_KEEP_FAILED:-0}" == "1" ]]; then
    printf 'W6 native baseline failed; diagnostic-only partial directory retained: %s\n' "$work" >&2
  else
    rm -rf -- "$work"
  fi
}
trap cleanup EXIT

started="$(date --iso-8601=seconds)"
gzip -cd "$DATA_DIR/Col-CC_v2_genome.fasta.gz" > "$work/genome.fa"
gzip -cd "$DATA_DIR/Unknown_CO100-001U0001_good_1.fq.gz" > "$work/reads_R1.fastq"
gzip -cd "$DATA_DIR/Unknown_CO100-001U0001_good_2.fq.gz" > "$work/reads_R2.fastq"
python3 "$ROOT/tools/w6-validation/prepare_hisat2_annotation.py" gff3-to-gtf \
  "$DATA_DIR/TAIR12_1Feb26.gff3.gz" "$work/annotation.gtf" --report "$work/annotation-conversion.json"
mkdir "$work/index"
"$HISAT2_DIR/hisat2-build-s" --threads "$THREADS" "$work/genome.fa" "$work/index/colcc-v2" > "$work/hisat2-build.stdout.txt" 2> "$work/hisat2-build.stderr.txt"
"$HISAT2_DIR/hisat2-align-s" --dta -p "$THREADS" -x "$work/index/colcc-v2" \
  -1 "$work/reads_R1.fastq" -2 "$work/reads_R2.fastq" \
  --summary-file "$work/hisat2_summary.txt" -S "$work/run.sam" > "$work/hisat2.stdout.txt" 2> "$work/hisat2.stderr.txt"
"$FEATURECOUNTS_BIN" -T "$THREADS" -s 0 -p --countReadPairs -t exon -g gene_id \
  -a "$work/annotation.gtf" -o "$work/featureCounts.txt" "$work/run.sam" > "$work/featureCounts.stdout.txt" 2> "$work/featureCounts.stderr.txt"
python3 "$ROOT/tools/w6-validation/prepare_hisat2_annotation.py" tpm "$work/featureCounts.txt" "$work/counts_with_tpm.tsv"
rm -f "$work/genome.fa" "$work/reads_R1.fastq" "$work/reads_R2.fastq" "$work/run.sam"
ended="$(date --iso-8601=seconds)"

{
  printf 'schema_version=1\nstarted_at=%s\nended_at=%s\nthreads=%s\n' "$started" "$ended" "$THREADS"
  printf 'hisat2_version=%s\n' "$("$HISAT2_DIR/hisat2-build-s" --version | head -1)"
  printf 'featurecounts_version=featureCounts v2.1.1\n'
  printf 'hisat2_build_args=--threads %s genome.fa index/colcc-v2\n' "$THREADS"
  printf 'hisat2_align_args=--dta -p %s -x index/colcc-v2 -1 reads_R1.fastq -2 reads_R2.fastq -S run.sam\n' "$THREADS"
  printf 'featurecounts_args=-T %s -s 0 -p --countReadPairs -t exon -g gene_id -a annotation.gtf -o featureCounts.txt run.sam\n' "$THREADS"
} > "$work/run-manifest.txt"
(cd "$work" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$work/SHA256SUMS"
mv "$work" "$DESTINATION"
completed=true
trap - EXIT
printf 'W6 native HISAT2 baseline created: %s\n' "$DESTINATION"
