Tiny synthetic smoke-test files for kallisto WebAssembly.

Files:
  transcripts.fa
  reads_R1.fastq
  reads_R2.fastq
  reads_R2_short.fastq (intentional paired-read count mismatch)

The FASTQ files are deliberately small but structurally valid:
- each record has four lines,
- sequence and quality strings have identical lengths,
- every read contains 31-mers present in transcripts.fa.

Expected smoke test:
1. Build an index from transcripts.fa with k=31 and threads=1.
2. Run paired-end quant with reads_R1.fastq and reads_R2.fastq.
3. kallisto should process more than zero reads and produce abundance.tsv and run_info.json.
4. Pairing reads_R1.fastq with reads_R2_short.fastq must fail with an explicit read-count mismatch error.
