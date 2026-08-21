# Product Architecture

Status: Phase 0/W1/W2 complete; Phase W3 measured large-file architecture gate passed; Phase W4 local hosted-catalog integrity passed; Phase W5 small end-to-end integration passed; Phase W6 production Web gate in progress and not release-complete.

## Audited baseline

The archive is a static HTML/CSS/JavaScript application whose public entry point is `index.html`. It packages kallisto 0.52.0 as a Memory64, pthread, SIMD-enabled WebAssembly runtime and runs commands in `js/kallisto-worker.js`. Biological inputs are mounted read-only with WORKERFS. Multiple samples run sequentially in one Worker and one Wasm module. Stop terminates that Worker.

The supplied archive also contained a patched kallisto checkout at upstream commit `4e9f29cf3b021260415430c057a22469ca081391` (`v0.52.0`) and build artifacts. The patched checkout is intentionally dirty relative to upstream; it is evidence, not a clean upstream source tree. No fastp, HISAT2, featureCounts, Tauri, production index catalog, or native analysis binary was present before W2 work; isolated proof artifacts have since been added under `tools/` without changing the stable product route.

## Web-first product surfaces

```text
index.html (unchanged public entry point)
  ├─ Kallisto in browser — stable/recommended and fully interactive
  ├─ HISAT2 + featureCounts in browser — experimental W5 form, synthetic catalog only
  └─ Desktop app — D1/D2 engineering accepted; unsigned and visibly unreleased
```

W1 adds product navigation and capability reporting without moving the entry point, replacing the framework, or simulating unimplemented engines.

## Scientific boundary

| Workflow | Reference | Algorithm | Primary unit | Primary values |
|---|---|---|---|---|
| Kallisto | Transcriptome | Pseudoalignment and abundance estimation | Transcript | Estimated count, transcript TPM |
| HISAT2 + featureCounts | Genome plus annotation | Genome alignment and annotation-based assignment | Gene or configured feature group | Raw count, Length, derived gene TPM |

The two TPM values are not interchangeable. The W5 UI and manifest preserve reference identity, feature type, grouping attribute, strandedness, and read/fragment counting unit.

## Stable Kallisto data flow

```text
File/Blob transcriptome or .idx
  -> main-thread validation and command preview
  -> Web Worker
  -> WORKERFS read-only mounts
  -> kallisto 0.52.0 Memory64/pthreads
  -> MEMFS output files
  -> small ArrayBuffer results returned to the UI
  -> local preview/download and batch matrices
```

FASTQ and index files are not copied into the main JavaScript heap by application code. The generated Kallisto index and output files are currently memory-backed; this remains a documented limitation.

## Experimental W5 data flow

```text
local FASTQ / FASTQ.gz
  -> optional fastp-Wasm
  -> HISAT2-Wasm + hosted, checksummed prebuilt index
  -> validated file-backed bounded-memory SAM handoff
  -> featureCounts-Wasm + compatible annotation
  -> raw counts + Length + TPM + summaries
```

This flow is product-integrated only at the experimental small-fixture boundary. Phase W2 validated each engine independently. Phase W3 selected WORKERFS read-only input plus OPFS descriptor-based sharing and direct Emscripten-device output after a 64 MiB persistence/reload test and an actual tiny HISAT2-to-featureCounts handoff. W4 validates the hosted-package boundary locally. W5 now orchestrates the complete flow and cleanup; W6 production hosting and scale acceptance remain required.

## Implemented W2 individual proof boundaries

The isolated `tools/fastp/` harness now runs pinned fastp 0.23.4 in a module Worker with pthreads. Browser `File` inputs are mounted read-only with WORKERFS; tiny proof outputs are kept in Worker-local MEMFS and returned only after the process exits. Terminating the outer Worker is the cancellation mechanism. The native algorithm source is preserved; the only portability patch replaces ISA-L/libdeflate gzip calls with pinned zlib calls.

The isolated `tools/hisat2/` harness runs the pinned 2.2.3 small-index aligner in its own module Worker. The index is built by the unmodified native `hisat2-build-s`, never in the browser. Tiny `.ht2` parts and reads are WORKERFS/MEMFS proof inputs. Its only source correctness change makes a reference-coordinate subtraction explicitly signed on wasm32; the resulting SE, PE, and splice alignments match native semantics.

The isolated `tools/featurecounts/` harness runs the featureCounts command from pinned Subread 2.1.1 in a separate module Worker. It accepts tiny SAM plus GTF/GFF3 and matches native raw count, union-exon Length, order, and summary. Its port patch is limited to Emscripten stdio, browser-inapplicable file-limit probes, log coloring, and module output naming.

The isolated proof pages remain separate from `index.html`. The product uses the typed W5 orchestrator rather than those proof clients and does not change the stable Kallisto data flow. W3 file-backed cleaned FASTQ and bounded SAM sharing exist under `tools/w3-storage`; W4 catalog/cache support exists under `tools/w4-catalog`; W5 integration exists under `tools/w5-pipeline` and `hisat2-workflow.html`.

## Implemented W4 hosted package boundary

`contracts/index-catalog.schema.json` defines a versioned reference package: exact HISAT2 version/build arguments, assembly and contigs, eight immutable index artifacts, compatible annotation metadata, per-file size/SHA-256, sources, licenses, and creation time. `config/index-catalog.json` explicitly selects the repository-local synthetic catalog and states that production is not configured.

A dedicated cache Worker streams each artifact directly into a checksum-addressed OPFS entry, bounds persistence writes, computes incremental SHA-256, scans annotation contigs, and writes `ready.json` only after all nine artifacts pass. The cache key includes the reference ID, exact HISAT2 version, and every index/annotation checksum. Interrupted `partial.json` entries are removed on recovery; corrupt entries are invalidated as a whole. Quota preflight, usage listing, and explicit deletion are exposed to the future BrowserRunner.

`reference-cache.html` is the W4 user-facing surface. It displays the explicit local-test/production configuration state, package identity and payload, selected-reference and browser quota usage, cache state, progress, full re-verification, and deletion/freed bytes. The enabled Experimental Home action opens `hisat2-workflow.html`, which uses the same validated catalog/cache boundary.

## Implemented W5 product boundary

`Hisat2WebRunner` validates sample names, extensions, empty files, structural FASTQ prefixes, lane counts, compression consistency, and PE read names. It processes samples sequentially; optional fastp outputs cleaned FASTQ directly to OPFS, gzip inputs are stream-decompressed to temporary OPFS entries, HISAT2 opens the W4 index and writes SAM directly to OPFS, and a separate featureCounts Worker reopens SAM and the compatible annotation. featureCounts rejects mapped contigs outside the annotation profile and every zero-assigned result. The main thread receives only small reports/counts/logs and output descriptors.

Successful completion removes temporary decompressed reads and SAM, calculates double-precision gene TPM with invalid-Length/zero-denominator handling, builds validated matrices, and returns the shared result-manifest contract. Optional cleaned FASTQ is retained only for download and explicit deletion. Worker termination plus prefix cleanup provides cancellation. Exact arguments appear in the UI before execution and are recorded from each engine's running event.

## Shared contracts

Machine-readable W1 contracts live in `contracts/`:

- `sample.schema.json`: SE/PE samples and basename/size-only input descriptors.
- `analysis-job.schema.json`: execution mode, engine, reference, exact argument arrays, stages, and privacy declaration.
- `result-manifest.schema.json`: status, per-sample results, output roles, warnings, and cleanup result.
- `runtime-event.schema.json`: log and determinate/indeterminate progress events.
- `cancel-request.schema.json`: cancellation request and cleanup-aware acknowledgement.
- `index-catalog.schema.json`: immutable hosted HISAT2 index/annotation package metadata and integrity fields.

The W5 BrowserRunner translates to these contracts rather than allowing the UI to pass raw shell command strings. A future DesktopRunner must do the same.

## Capability boundary

`js/browser-capabilities.mjs` measures WebAssembly, Worker, cross-origin isolation, SharedArrayBuffer, SHA-256, storage estimate, OPFS, gzip streaming, hardware concurrency, and quota values when the browser exposes them. It does not infer support solely from `hardwareConcurrency`; W5 is enabled because the end-to-end gate passed, while unsupported environments remain disabled.

## Privacy and network

- Current network use: static HTML/CSS/JavaScript and Wasm from the application origin.
- Current biological data transfer: none.
- Current W5 test network use: same-origin downloads of the committed synthetic HISAT2 index and annotation fixture.
- Future production network use: immutable/versioned hosted HISAT2 index and annotation downloads from an explicitly configured origin.
- Prohibited: FASTQ/FASTA/annotation/result upload for analysis, telemetry without separate consent, or remote content in a desktop WebView.

The current CSP has `connect-src 'self'`. Any future cross-origin index CDN requires a reviewed CSP change plus CORS, CORP, COOP, and COEP validation.
