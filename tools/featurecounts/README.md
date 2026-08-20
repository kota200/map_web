# Subread/featureCounts 2.1.1 W2 proof

This directory is an individual, non-product-integrated WebAssembly proof for
the standalone featureCounts 2.1.1 command from Subread 2.1.1.

The isolated browser patch does not alter assignment/counting logic. It uses
Emscripten stdio instead of unavailable `fopen64`, skips host file-descriptor
limit probes, strips terminal color from captured logs, and emits an ES module.

The fixture covers GTF and GFF3 annotation parsing, single-end read counting,
paired-end fragment counting (`-p --countReadPairs`), raw count, union exon
Length, gene order, and assignment summary. The expected `g1` results are
SE count 2, PE count 1, and Length 160.

Run from WSL Ubuntu:

```bash
tools/featurecounts/run-native-baseline.sh
tools/featurecounts/build-wasm.sh
```

Then run with the bundled Node.js runtime:

```text
node tools/featurecounts/tests/run-node-wasm.mjs
node tools/featurecounts/tests/compare-results.mjs
node tools/featurecounts/tests/cancel-worker.mjs
node tools/featurecounts/tests/static-runtime.mjs
```

W2 uses tiny SAM and annotation files in an outer module Worker. The browser
handoff of a large HISAT2 SAM and real memory/storage peaks remain W3 work.
