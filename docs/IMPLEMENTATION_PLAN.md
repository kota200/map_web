# Implementation Plan

## Current status

| Phase | Status | Gate evidence |
|---|---|---|
| Phase 0 | Complete for the supplied archive | Provenance, baseline browser run, golden outputs, automated browser harness, header check, architecture, risk, version/license matrix |
| Phase W1 | Implemented | Existing URL retained, stable Kallisto UI retained, honest chooser, shared contracts, capability/storage check, unsupported experimental workflow disabled |
| Phase W2 | Complete: three individual proofs passed | fastp 0.23.4, HISAT2 2.2.3, and featureCounts 2.1.1 have pinned source/toolchains, reproducible Wasm artifacts, native semantic baselines, Node and Chromium integration, logs/exit capture, and Worker cancellation evidence. |
| Phase W3 | Complete at measured architecture scale | 64 MiB Worker/OPFS measurement, bounded hosted-file persistence, reload recovery, quota rejection, direct fastp/HISAT2 OPFS output, and separate-Worker featureCounts handoff passed in Chromium |
| Phase W4 | Complete for local hosted-catalog acceptance | Schema/config/test catalog, all size/SHA-256 checks, checksum/version cache key, atomic ready marker, cancellation recovery, retry, reload, corruption invalidation, quota/usage/delete UI, and annotation-contig compatibility passed in Chromium. Production URL remains deliberately unconfigured. |
| Phase W5 | Complete for the small local-catalog Web gate | Typed SE/PE pipeline, raw gzip, optional fastp OFF/ON, HISAT2, featureCounts fragment semantics, TPM/matrices, exact arguments, outputs, cancellation, and cleanup passed in Chrome 151 |
| Phase W6 | In progress; not release-complete | Chrome Kallisto fastp OFF/ON, cleanup/failure gates, and an instrumented 3.10 GB paired Arabidopsis Kallisto run passed. Kallisto Wasm linear-memory high water is now measured; production HISAT2 catalog/biology, eviction/recovery at production scale, Firefox, and Safari remain open. |
| Desktop | Not started | Prohibited until the Web release gate passes |

## Next executable Web phases

1. **W2 fastp proof of concept — acceptance passed**
   - Pinned fastp 0.23.4, native validation packages, Emscripten 6.0.6, and zlib 1.3.2.
   - Captured native gzip SE/PE cleaned FASTQ, JSON/HTML, stdout/stderr, exact command, and exit code.
   - Kept the gzip-only browser adaptation in an exact-match patch generator.
   - Matched decompressed records/order and major JSON QC metrics in Node and a real Chromium Worker; malformed input and running-state cancellation also passed.
2. **W2 HISAT2 proof of concept — acceptance passed**
   - Pinned full v2.2.3 commit and canonical archive hash; built the tiny eight-part index outside the browser.
   - Matched SE, PE, splice CIGAR, flags, mate fields, AS/NM tags, summary, and TLEN against native output.
   - Isolated a one-line wasm32 signed-coordinate correction; source scoring/alignment logic otherwise remains upstream.
3. **W2 featureCounts proof of concept — acceptance passed**
   - Pinned the official Subread 2.1.1 source archive by SHA-256.
   - Matched GTF/GFF3 raw counts, union exon Length, gene order, and full assignment summary for SE reads and PE fragments.
   - Kept browser changes at stdio, host-limit probing, captured-log, and module-output boundaries.
4. **W3 large-file gate — acceptance passed at measured scale**
   - Selected WORKERFS input + OPFS persistence + a synchronous Emscripten output device after comparing MEMFS, IDBFS, WasmFS, and transferable alternatives.
   - Proved persistent 64 MiB Worker I/O, bounded writes, main-thread heartbeat, quota preflight, reload recovery, cancellation cleanup, and a real file-backed fastp/HISAT2/featureCounts boundary.
   - Did not generalize this result to multi-GiB biological data; representative production-scale benchmarking remains a W6 release input.
5. **W4 hosted index catalog — local acceptance passed**
   - Added an explicit local-test configuration point and JSON Schema without inventing a production URL.
   - Verified all eight `.ht2` files plus GTF by exact size and incremental SHA-256 before publishing a ready marker.
   - Passed quota rejection, Worker-termination recovery, retry, page-reload re-hash, same-size corruption invalidation, manifest-checksum failure cleanup, usage display primitive, delete, and contig compatibility.
   - Added the user-facing `reference-cache.html` manager for catalog selection, download/full re-verification, selected/browser storage display, and explicit deletion while leaving analysis disabled.
6. **W5 integration — acceptance passed for the small local fixture**
   - Added the typed sequential fastp → HISAT2 → featureCounts → gene-TPM runner and product form.
   - Passed two-sample SE matrices, PE fragment counting, raw `.fq.gz`, fastp ON/OFF, malformed-input rejection, exact argument capture, running-state cancellation, and zero residual W5 OPFS artifacts.
   - Enabled the product card with explicit Experimental/local-synthetic/W6-pending boundaries.
7. **W6 production Web release gate — in progress**
   - Passed Chrome 151 Kallisto fastp OFF/ON equivalence, retained-output deletion, running-state cancellation cleanup, storage/memory-envelope errors, hosted checksum failure, annotation-contig mismatch, and the complete existing Kallisto/W5 browser regressions.
   - Re-measured the supplied Arabidopsis Kallisto inputs with tracked Wasm memory: the 90,392,408-byte cDNA FASTA produced a 141,751,322-byte index in 201 seconds with a 1,120,010,240-byte linear-memory high water; 3,102,512,503 bytes of paired gzip FASTQ completed in 882 seconds with 23,809,408 processed and 23,373,083 pseudoaligned reads and a 747.8 MiB rounded linear-memory high water.
   - The earlier 141,752,090-byte representative index differed by 768 bytes while graph-contig and k-mer counts were identical, so byte-for-byte determinism is not claimed for this representative build.
   - Keep the release gate open because only a local synthetic HISAT2 package exists and Firefox/Safari are unmeasured. Wasm allocation is now measured for the representative Kallisto run, but OS/browser-process resident memory and a portable support threshold are not claimed.
   - Configure a real HTTPS catalog only after reference provenance/licensing and hosting are approved. The supplied genome FASTA and GFF3 have matching contigs; build or obtain an exact-version HISAT2 index, generate native expected alignment/counts/Length/TPM, and obtain approved immutable URLs.

## Change control

- Run the dependency-free Node tests before and after UI or Worker changes.
- Run `build/browser-regression.html` in a real Chromium browser before and after any runtime, Worker, input, or result change.
- Never run `build/prepare-clean-source.sh` against the only archived patched source. Work from a separate clean checkout and regenerate a patch.
- Do not change the packaged Wasm runtime or upstream algorithm as part of product-shell work.
- Do not claim Firefox, Safari, large-data, production-hosted-reference, or desktop support without measured evidence.
- Keep isolated proof runners separate from the W5 product form; only the typed W5 runner and validated catalog/cache boundary may back the experimental UI.
