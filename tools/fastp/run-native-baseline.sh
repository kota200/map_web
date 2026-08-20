#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FASTP="$PROJECT_ROOT/.w2-cache/build/fastp-native-v0.23.4/fastp"
DEPS_ROOT="$PROJECT_ROOT/.w2-cache/native-deps/root"
INPUT_DIR="$PROJECT_ROOT/test-data/fastp/inputs"
OUTPUT_DIR="$PROJECT_ROOT/test-data/fastp/native-v0.23.4"
FASTP_NATIVE_LIBRARY_PATH="$DEPS_ROOT/usr/lib/x86_64-linux-gnu"

"$PROJECT_ROOT/tools/fastp/build-native.sh"
"$PROJECT_ROOT/tools/fastp/prepare-fixtures.sh"
mkdir -p "$OUTPUT_DIR"

run_case() {
  local name="$1"
  shift
  set +e
  LD_LIBRARY_PATH="$FASTP_NATIVE_LIBRARY_PATH" "$FASTP" "$@" \
    >"$OUTPUT_DIR/$name.stdout.log" \
    2>"$OUTPUT_DIR/$name.stderr.log"
  local exit_code=$?
  set -e
  printf '%s\n' "$exit_code" > "$OUTPUT_DIR/$name.exit-code.txt"
  if [[ "$exit_code" -ne 0 ]]; then
    echo "ERROR: native fastp case $name exited $exit_code" >&2
    return "$exit_code"
  fi
}

run_case se \
  --in1 "$INPUT_DIR/se.fastq.gz" \
  --out1 "$OUTPUT_DIR/se.cleaned.fastq.gz" \
  --json "$OUTPUT_DIR/se.fastp.json" \
  --html "$OUTPUT_DIR/se.fastp.html" \
  --report_title "fastp W2 SE fixture" \
  --thread 1 \
  --dont_eval_duplication \
  --disable_trim_poly_g \
  --adapter_sequence AGATCGGAAGAGCACACGTCTGAACTCCAGTCA \
  --length_required 15 \
  --compression 4

run_case pe \
  --in1 "$INPUT_DIR/pe.R1.fastq.gz" \
  --in2 "$INPUT_DIR/pe.R2.fastq.gz" \
  --out1 "$OUTPUT_DIR/pe.R1.cleaned.fastq.gz" \
  --out2 "$OUTPUT_DIR/pe.R2.cleaned.fastq.gz" \
  --json "$OUTPUT_DIR/pe.fastp.json" \
  --html "$OUTPUT_DIR/pe.fastp.html" \
  --report_title "fastp W2 PE fixture" \
  --thread 1 \
  --dont_eval_duplication \
  --disable_trim_poly_g \
  --disable_adapter_trimming \
  --length_required 15 \
  --compression 4

sha256sum "$OUTPUT_DIR"/* > "$OUTPUT_DIR/SHA256SUMS"
echo "Native fastp 0.23.4 SE/PE baseline completed in $OUTPUT_DIR"
