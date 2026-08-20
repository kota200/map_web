# Build and Test Procedures

## Dependency-free checks

From the application root with Node.js 18 or later:

```text
node build/check-static.mjs
node build/test-batch-results.mjs
node build/test-worker-lifecycle.mjs
node build/test-contracts.mjs
node build/test-product-shell.mjs
node tools/w3-storage/tests/static-contract.mjs
node tools/w4-catalog/tests/static-contract.mjs
node tools/w5-pipeline/tests/static-contract.mjs
```

## Local server and headers

```text
python build/serve.py
node build/check-headers.mjs http://127.0.0.1:8000/
```

Use `python build/serve.py --port 8123` and the matching URL when port 8000 is occupied.

The server must return COOP `same-origin`, COEP `require-corp`, CORP `same-origin`, and `application/wasm` for the runtime.

## Actual browser/Wasm regression

Open:

```text
http://127.0.0.1:8000/build/browser-regression.html
```

Pass requires exact archived abundance and matrices, deterministic run counters, timeout-bounded Worker/Wasm R1/R2 mismatch rejection, and Worker cancellation acknowledgement. This is an integration test; it compiles and runs the packaged Memory64 runtime in the browser.

## Wasm rebuild

The archived instructions use:

```text
source ~/emsdk/emsdk_env.sh
bash build/build-wasm.sh
```

Do not run this against the only archived patched source. The script hard-resets and cleans `vendor/kallisto` before regenerating patches. First preserve the archive and work in a disposable clean checkout. WSL now has a toolchain for the independently pinned fastp proof, but the exact compiler used for the archived Kallisto runtime remains unknown; a Kallisto rebuild was not attempted.

## fastp 0.23.4 W2 proof

The fastp harness is independent of the archived Kallisto build. Run from Ubuntu/WSL at the application root:

```text
bash tools/fastp/build-native.sh
bash tools/fastp/run-native-baseline.sh
FASTP_EMSDK_DIR=/absolute/path/to/emsdk bash tools/fastp/build-wasm.sh
node tools/fastp/test/run-node-wasm.mjs
node tools/fastp/test/static-runtime.mjs
node tools/fastp/test/compare-results.mjs
node tools/fastp/test/cancel-worker.mjs
```

Then serve with `python build/serve.py` and open `tools/fastp/test/browser-integration.html`. Pass requires native-equivalent decompressed SE/PE outputs and QC metrics, captured stderr, exit 0, malformed-input nonzero exit, and running-state Worker cancellation.

The current exact local SDK path is environment-specific. `build-wasm.sh` accepts `FASTP_EMSDK_DIR` but rejects any compiler version other than 6.0.6.

## Phase W3 browser large-file gate

The W3 harness requires a real browser because OPFS synchronous access handles exist only in dedicated Workers. Start the header-aware server and open:

```text
node tools/w3-storage/tests/static-contract.mjs
python build/serve.py
http://127.0.0.1:8000/tools/w3-storage/tests/browser-gate.html
```

The page reloads itself once. Pass requires a bounded 64 MiB OPFS write/read with matching streaming checksum and a responsive main-thread heartbeat; size/quota failure; ready/partial reload recovery; same-origin streamed index persistence; direct fastp cleaned-FASTQ and HISAT2 SAM device output; descriptor-only featureCounts input; Worker-termination cleanup; and no remaining `w3-gate-*` entries.

This harness generates stress data at runtime and does not commit a large fixture. It is not a substitute for the W6 production-scale biological benchmark.

## Phase W4 hosted index catalog gate

Run the dependency-free contract/hash test, start the same header-aware server, and open:

```text
node tools/w4-catalog/tests/static-contract.mjs
python build/serve.py
http://127.0.0.1:8000/tools/w4-catalog/tests/browser-catalog-gate.html
http://127.0.0.1:8000/reference-cache.html
```

The page reloads itself once. Pass requires exact size/SHA-256 validation for eight `.ht2` parts plus GTF, a cache key containing the reference ID/HISAT2 version/all checksums, quota rejection, interrupted-download recovery, retry, atomic ready state, reload re-hash, annotation-contig compatibility, same-size corruption invalidation, catalog-checksum mismatch cleanup, usage listing, explicit delete/freed bytes, and zero remaining reference entries.

The user-facing cache page must identify the catalog as local-test when production is unconfigured. Exercise Download / verify twice (the second run must report full re-verification), confirm selected-reference/browser usage and ready state, delete the cache, and confirm usage returns to not cached with the delete action disabled.

## Phase W5 end-to-end browser gate

Run the W5 native-result/preflight/TPM contract test and open the actual browser pipeline gate:

```text
node tools/w5-pipeline/tests/static-contract.mjs
python build/serve.py
http://127.0.0.1:8000/tools/w5-pipeline/tests/browser-gate.html
http://127.0.0.1:8000/hisat2-workflow.html
```

Pass requires two sequential SE samples with exact matrices; raw `.fq.gz` with fastp OFF; PE fragment counting with `-p --countReadPairs`; fastp ON with before/after QC and retained-then-deleted cleaned FASTQ; malformed FASTQ rejection; running-state HISAT2 cancellation with `AbortError`; exact count/Length/TPM values; and zero remaining W5 temporary OPFS entries. The product form must keep fastp OFF initially, offer explicit threads 1–4, expose exact argument previews, label the catalog synthetic/local-test, and link from the enabled Experimental Home card.

## Phase W6 browser release gate

Run the W6 static contract and open its browser gate in addition to the archived Kallisto and W5 gates:

```text
node tools/w6-validation/tests/static-contract.mjs
http://127.0.0.1:8000/tools/w6-validation/tests/browser-gate.html
```

The W6 page requires exact Kallisto fastp OFF/ON results, fastp reports and QC, explicit retained-output deletion, running-state cancellation with zero residual OPFS entries, storage/Wasm-envelope preflight errors, hosted checksum failure, and annotation/index-contig mismatch. The product UI must keep Kallisto fastp OFF initially and expose the same reports and delete action.

The representative Chrome measurement uses the files locked in `tools/w6-validation/example-data.lock.json`; it must be recorded separately from synthetic acceptance. The tracked runtime reports final shared Wasm linear-memory byteLength as a high-water allocation because Wasm memory does not shrink; it does not report OS resident memory. Do not mark W6 complete while production HISAT2 biology/hosting, Firefox, or Safari remain unmeasured.

## HISAT2 2.2.3 W2 proof

Run from Ubuntu/WSL at the application root:

```text
bash tools/hisat2/run-native-baseline.sh
HISAT2_EMSDK_DIR=/absolute/path/to/emsdk bash tools/hisat2/build-wasm.sh
node tools/hisat2/tests/run-node-wasm.mjs
node tools/hisat2/tests/compare-results.mjs
node tools/hisat2/tests/cancel-worker.mjs
node tools/hisat2/tests/static-runtime.mjs
```

Then serve with `python build/serve.py` and open `tools/hisat2/tests/browser-integration.html`. Pass requires native-equivalent SE, PE, and spliced SAM semantics, 100% fixture summaries, captured stdout/stderr and exit code, and running-state Worker cancellation. The browser uses only the prebuilt tiny index; `hisat2-build` remains native-only.

## Subread/featureCounts 2.1.1 W2 proof

Run from Ubuntu/WSL at the application root:

```text
bash tools/featurecounts/run-native-baseline.sh
FEATURECOUNTS_EMSDK_DIR=/absolute/path/to/emsdk bash tools/featurecounts/build-wasm.sh
node tools/featurecounts/tests/run-node-wasm.mjs
node tools/featurecounts/tests/compare-results.mjs
node tools/featurecounts/tests/nonzero-exit.mjs
node tools/featurecounts/tests/cancel-worker.mjs
node tools/featurecounts/tests/static-runtime.mjs
```

Then serve with `python build/serve.py` and open `tools/featurecounts/tests/browser-integration.html`. Pass requires native-equivalent GTF SE read counts, GTF PE fragment counts, GFF3 counts, union-exon Length, complete assignment summary, captured exit/logs, and running-state Worker cancellation.
