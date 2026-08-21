# RNA-seq Local — kallisto Web v10.4 batch

Web-first RNA-seq analysis. The current stable and recommended workflow is browser-only kallisto v0.52.0 for local transcriptome pseudoalignment and transcript-level quantification.
Selected FASTA/FASTQ/index files are mounted inside a Web Worker with Emscripten WORKERFS and are not uploaded by the application.

Phase W2 individual WebAssembly proofs are complete for fastp 0.23.4, HISAT2 2.2.3, and Subread/featureCounts 2.1.1. Phase W3 selected and measured a bounded file boundary: WORKERFS read-only inputs, OPFS persistence, and direct Emscripten-device output for cleaned FASTQ and SAM. Phase W4 provides a local-test hosted-index catalog contract and checksum-verified OPFS cache. Phase W5 integrates those pieces as an experimental, small-fixture browser workflow. W6 now includes Kallisto fastp ON/OFF, Web resource preflight, failure-recovery gates, one representative Arabidopsis Kallisto measurement, and automated Chromium/Firefox gates; production HISAT2 hosting/scale and real Safari remain open.

## Product phase

- **Phase 0 complete in this source tree:** archive provenance, architecture, risk register, version/license matrix, deterministic tiny scientific baseline, deployment-header check, and an actual browser/Wasm regression harness.
- **Phase W1 implemented:** product navigation, scientific method boundaries, shared JSON contracts, and browser/storage capability checks.
- **Phase W2 complete at the individual-engine boundary:** native/Wasm semantic acceptance passed for fastp, HISAT2, and featureCounts.
- **Phase W3 architecture gate passed at measured scale:** 64 MiB OPFS persistence/reload, quota rejection, Worker-termination recovery, file-backed fastp output, and the real HISAT2-to-featureCounts handoff passed without full-size main-thread or Worker byte transfers.
- **Phase W4 local catalog gate passed:** the synthetic nine-artifact HISAT2/GTF package is fully size/SHA-256 verified, committed atomically, retained across reload, invalidated on corruption, recoverable after cancellation, size-reporting, and deletable. `reference-cache.html` provides the working download/re-verify, usage, and delete UI. Production hosting is deliberately unconfigured.
- **Phase W5 small end-to-end gate passed:** `hisat2-workflow.html` supports sequential SE/PE samples, all four FASTQ extensions, optional fastp (default OFF), hosted cached references, HISAT2, featureCounts read/fragment counting, gene TPM, matrices, typed progress, downloadable result manifests, cancellation, and temporary-artifact cleanup. The only configured catalog is synthetic and must not be used for biological interpretation.
- **Phase W6 in progress:** Chrome 151 passed the representative 3.10 GB Kallisto measurement. Actions run `32458539850` also passed the archived Kallisto, W5, and W6 small-fixture gates in Chromium 140 and Firefox 141. Firefox remains Experimental because representative scale is unmeasured. Playwright WebKit 26 lacked OPFS and the packaged Kallisto runtime; it is a diagnostic result, not Safari evidence. Production HISAT2 hosting/scale, storage eviction at production scale, and real Safari remain open.
- **Desktop D1/D2 engineering acceptance complete:** verified native sidecars and unsigned Windows/macOS/Linux installers exist. Signing, notarization, legal approval, and signed-install testing remain release blockers.

Kallisto transcript TPM and featureCounts-derived gene TPM are not interchangeable. See `docs/PRODUCT_ARCHITECTURE.md` and `help.html`.

## Audit and validation

Run the dependency-free static tests with Node.js:

```text
node build/check-static.mjs
node build/test-batch-results.mjs
node build/test-worker-lifecycle.mjs
node build/test-contracts.mjs
node build/test-product-shell.mjs
node tools/w3-storage/tests/static-contract.mjs
node tools/w4-catalog/tests/static-contract.mjs
node tools/w5-pipeline/tests/static-contract.mjs
node tools/w6-validation/tests/static-contract.mjs
```

Start the header-aware server, validate deployment headers, then open the actual browser regression page:

```text
python build/serve.py
node build/check-headers.mjs http://127.0.0.1:8000/
http://127.0.0.1:8000/build/browser-regression.html
http://127.0.0.1:8000/tools/w3-storage/tests/browser-gate.html
http://127.0.0.1:8000/tools/w4-catalog/tests/browser-catalog-gate.html
http://127.0.0.1:8000/reference-cache.html
http://127.0.0.1:8000/tools/w5-pipeline/tests/browser-gate.html
http://127.0.0.1:8000/tools/w6-validation/tests/browser-gate.html
http://127.0.0.1:8000/hisat2-workflow.html
```

If port 8000 is already in use, choose another explicit port, for example `python build/serve.py --port 8123`, and pass the same base URL to the header check.

The browser harness builds the tiny index, runs paired-end quantification through the packaged Wasm runtime, compares `abundance.tsv`, `run_info.json`, and batch matrices with archived golden results, verifies the R1/R2 mismatch in the Worker with a hard timeout, and checks Worker cancellation.

## v10.4 batch and FASTQ changes

- Dynamic sample cards support one or more paired-end or single-end samples.
- A batch uses one Worker/Wasm module. The shared index is mounted once; sample FASTQ mounts and output directories are created and removed sequentially.
- Each sample receives a fresh zero-copy `Blob.slice()` view and a private WORKERFS mount. Stable `/reads/...` symlinks preserve the kallisto command recorded in `run_info.json`, while preventing an exhausted large-file Blob/mount lifetime from leaking into the next sample.
- `ParseOptionsEM` rebuilds its `getopt_long` option table for every `callMain` invocation. This prevents its flag entries from retaining pointers to the previous sample's stack and corrupting the next sample's quant mode.
- Normal paired-end Wasm quant decompresses the independent R1/R2 gzip streams concurrently inside the existing locked batch-acquisition phase. One bounded helper pthread is used; read pairing, order, mismatch detection, and downstream pseudoalignment/EM are unchanged.
- `browser_performance.json` records the requested/active read workers plus per-worker batch, read, reader-wait, fetch, pseudoalignment, and result-merge timings.
- `counts_matrix.tsv` and `tpm_matrix.tsv` are generated from `target_id`, `est_counts`, and `tpm`. Target count, IDs, duplicates, and order are validated, and fractional counts are not rounded.
- The Wasm read buffer is 32 MiB per worker for 1-4 threads and 16 MiB per worker for 5-8 threads (maximum 128 MiB of primary read buffers).
- Every `gzopen()` input stream receives a 1 MiB `gzbuffer()` before its first `kseq_read()`.
- Paired FASTQ read-count mismatches and truncated records are explicit errors.
- The existing reader lock still protects only batch acquisition. Pseudoalignment remains outside the lock.
- Wasm linear memory has a 3 GiB hard ceiling (`3221225472` bytes); FASTQ/index files remain File/Blob-backed through WORKERFS.
- Browser timing records the sample name and compiled read/gzip buffer sizes. Wasm initialization is measured for the first sample and is `0` for later samples in the reused module.

## v10 base changes retained

v10 keeps the existing browser/Wasm architecture and adds three performance-oriented changes:

1. **Browser performance measurement**
   - The worker uses `performance.now()`.
   - A few lightweight `[WEBPERF]` checkpoints are inserted into the standard kallisto `quant` path without changing the numerical algorithm.
   - Every successful quant run adds `browser_performance.json` alongside the standard `run_info.json` and `abundance.tsv`.
   - Recorded stages include Wasm initialization, input mounting, index loading, FASTQ processing/pseudoalignment, EM, output generation, output collection, kallisto call time, total time, and read throughput.
   - The UI accepts 1-8 threads so the same data can be benchmarked with `-t 1`, `-t 2`, `-t 4`, and `-t 8`.

2. **Release optimization**
   - `-O3`
   - `-flto`
   - `-msimd128`
   - native WebAssembly Memory64 (`-sMEMORY64=1`)
   - pthread pool size 9 (up to 8 read workers plus one bounded paired-gzip helper)
   - 8 MiB main and pthread stacks

3. **zlib-ng for `.gz` FASTQ/FASTA input**
   - v10 builds kallisto's vendored `ext/zlib-ng` directly in the same Emscripten CMake tree.
   - `ZLIB_COMPAT=ON` preserves the normal zlib/gzFile API used by kallisto/kseq.
   - The link does not use Emscripten `-sUSE_ZLIB=1`.

## Important: rebuild the Wasm runtime

The repository includes the built runtime matching this source. Rebuild it after changing the C++ patch or toolchain options.

Activate Emscripten and build:

```bash
source ~/emsdk/emsdk_env.sh
bash build/build-wasm.sh
```

The build script resets the vendored kallisto checkout to a clean v0.52.0 state, applies the v10 patch, configures zlib-ng, and verifies that the final kallisto link command contains:

- `-sMEMORY64=1`
- `-sMAXIMUM_MEMORY=3221225472`
- `-flto`
- `-msimd128`
- 8 MiB stack settings
- a zlib-ng `libz.a`

It also rejects accidental `-sUSE_ZLIB=1`, ASan, UBSan, or `MEMORY64=2` leakage in the release build.

Successful output is written to:

```text
kallisto/kallisto.js
kallisto/kallisto.wasm
kallisto/build-info.txt
```

## Local server / deployment

```bash
python3 build/serve.py
```

Open:

```text
http://127.0.0.1:8000/
```

A pthread build requires cross-origin isolation. The included local server and Apache `.htaccess` provide the required COOP/COEP headers.

## Recommended benchmark

Use the exact same reference/index and FASTQ pair for each run, keep bootstrap = 0, and run:

```text
-t 1
-t 2
-t 4
-t 8
```

Compare `browser_performance.json`, especially:

```text
fastq_processing_pseudoalignment_sec
reads_per_sec
total_sec
total_reads_per_sec
```

Also confirm that `run_info.json` gives identical `n_processed`, `n_pseudoaligned`, `n_unique`, and abundance results across thread counts.

## browser_performance.json

Example shape:

```json
{
  "sample": "sample1",
  "threads": 4,
  "browser_threads": 16,
  "wasm_initialization_sec": 0.123,
  "input_mount_sec": 0.002,
  "index_loading_sec": 1.234,
  "fastq_processing_pseudoalignment_sec": 30.456,
  "em_sec": 0.912,
  "output_generation_sec": 0.021,
  "kallisto_call_sec": 32.8,
  "output_collection_sec": 0.001,
  "total_sec": 33.1,
  "n_processed": 23809408,
  "reads_per_sec": 781768.2,
  "total_reads_per_sec": 719317.5,
  "read_batch_bytes": 33554432,
  "gzip_buffer_bytes": 1048576
}
```

Values above are only an example; the actual file is generated from the browser run.

## Existing functionality retained

- `kallisto index` in the browser
- existing `.idx` input
- paired-end / single-end FASTQ and FASTQ.gz
- multiple lane files for one sample
- multiple samples processed sequentially in one Wasm module
- `kallisto quant --plaintext`
- bootstraps, seed, strandedness, single-end fragment parameters
- local downloads of index and quant outputs
- FASTQ structural preflight
- stop button by worker termination
- WORKERFS input mounting
- native Memory64 and the previous 8 MiB stack fix
- a 3 GiB Wasm linear-memory ceiling

## Notes on correctness

The v10 performance flags and zlib-ng substitution are build/runtime optimizations; the kallisto pseudoalignment and EM algorithms are not replaced. Nevertheless, benchmark the same sample against the previous working Wasm build and verify identical quantification outputs before using v10 as the default production build.

## v10.3 source-bootstrap fix

The source ZIP intentionally omits `vendor/kallisto/.git`. If `vendor/kallisto` already exists but is not a Git checkout, `build/build-wasm.sh` now removes that stale/copied tree and clones a fresh kallisto v0.52.0 checkout automatically before patching. This prevents the `kallisto source is not a git checkout` failure seen in v10.3.

## v10.3 stability note

v10.3 keeps the v10 performance features but scopes `-flto`/`-msimd128` to the quantification hot path and vendored zlib-ng. Bifrost and kallisto index serialization/deserialization remain at conservative `-O3`. Binary index deserialization is forced to one thread; the user-selected thread count is still used for FASTQ pseudoalignment. Additional `[WEBPERF]` checkpoints report graph, D-list and node-metadata loading so index-tail corruption or deserialization failures are easier to identify.
