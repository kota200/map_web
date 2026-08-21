# Phase W6 Web Validation

W6 is a release gate, not a performance-claim generator. It keeps measured observations separate from audited limits and explicitly records missing evidence.

## Static gate

```text
node tools/w6-validation/tests/static-contract.mjs
```

Set `W6_VERIFY_LARGE_HASHES=1` to re-hash the three user-supplied representative files. The default test checks their locked sizes without reading 3.10 GB on every run.

## Browser gate

Serve the app with either `build/serve.py` or the dependency-free Node server:

```text
node tools/w6-validation/serve.mjs --port 8000
```

Then open:

```text
tools/w6-validation/tests/browser-gate.html
```

The gate requires cross-origin isolation and OPFS. It verifies Kallisto fastp OFF/ON equivalence, fastp reports/retention/deletion, running-state cancellation cleanup, audited resource failures, hosted checksum failure, and annotation/index-contig mismatch. Run the archived Kallisto regression and W5 gate separately as part of the same release check.

`.github/workflows/web-w6.yml` automates those three browser pages. Chromium and
Firefox are required jobs. The WebKit job is diagnostic and may fail while
Safari remains unmeasured: Playwright WebKit on Linux is not evidence from
Apple Safari on macOS. Each job uploads a JSON report, server log, and a failure
screenshot when applicable.

For an environment with Playwright installed, the same harness can be run as:

```text
node tools/w6-validation/run-browser-gates.mjs --browser chromium
```

## Representative data

`profile_example_data.py` streams the user-supplied FASTA and paired gzip FASTQ without creating derivatives. The first Chrome observation is frozen in `reports/chromium-151-2026-08-18.json`; the tracked-Wasm-memory rerun is frozen in `reports/chromium-151-memory-2026-08-20.json`. Both are summarized in `docs/VALIDATION_REPORT.md`.

The representative inputs include a genome FASTA and GFF3 whose `Chr1`–`Chr5` contigs match. `representative-hisat2/` now retains the generated HISAT2 2.2.3 index and native baseline. An approved production HTTPS catalog remains a separate release decision.

`run_hisat2_native_baseline.sh` builds the pinned HISAT2 2.2.3 index and produces the native paired-end alignment summary, featureCounts raw count/Length output, and derived TPM table. It writes through a temporary directory and removes expanded FASTQ and SAM before atomically publishing the completed result directory.
