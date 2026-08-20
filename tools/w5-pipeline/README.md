# Phase W5 HISAT2 Web pipeline

W5 integrates the accepted W2 engines with the W3 file boundary and W4 hosted reference cache. It is a browser-only, hosted-index workflow; it never runs `hisat2-build` and never uploads FASTQ or results.

The BrowserRunner processes samples sequentially. Optional fastp is off by default. Cleaned FASTQ and SAM are written directly to OPFS; only descriptors cross Worker boundaries. SAM is always temporary and deleted after featureCounts. When fastp runs, cleaned gzip FASTQ is a named output retained for explicit download/removal.

Small text/report outputs are returned to the page:

- per-sample counts, counts plus TPM, raw featureCounts files, HISAT2 summary, run metadata, and non-empty logs;
- fastp cleaned FASTQ, JSON, and HTML only when preprocessing ran;
- batch count/TPM matrices after exact Geneid/Length/order validation;
- batch manifest and cleanup-aware result manifest.

TPM uses `count / Length`, normalized by the sum of all rates to one million. Invalid Length/count values fail. A zero denominator produces finite zeros and an explicit warning.

Run the static gate with `node tools/w5-pipeline/tests/static-contract.mjs`. The browser gate and product page require `build/serve.py` because Wasm pthreads, OPFS synchronous handles, and cross-origin isolation are browser-only.
