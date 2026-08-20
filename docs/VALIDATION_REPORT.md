# Validation Report

Date: 2026-08-17

## Environment

- Host: Windows, x64.
- Browser used for the final W3 and post-change regression runs: Chrome 151.0.0.0 in the Chromium-based Codex in-app browser on Windows x64.
- Bundled test Node.js: 24.19.0.
- Bundled test Python: 3.12.13.
- Git: 2.52.0.windows.1.
- Windows host PATH still has no Emscripten/Bash/native bioinformatics CLI. WSL2 Ubuntu 22.04.5 provides g++ 11.4, CMake 3.22.1, Make, Git, and Node; a project-dedicated emsdk 6.0.6 was installed without changing the host PATH.
- Exact archived Emscripten version: not recoverable from the supplied build metadata.
- W2 toolchain: Emscripten 6.0.6 (`ce75e06...`), emsdk `bfce670...`; fastp and featureCounts use the pinned zlib 1.3.2 port. Exact pins and hashes are in each tool's `source.lock.json`.

## Pre-change stable Kallisto baseline

The actual UI built the tiny transcriptome index and ran the paired FASTQ fixture through the packaged Worker/Wasm runtime. The result was 2 processed fragments, 2 pseudoaligned fragments, and two transcript rows with estimated count 1 and TPM 500,000 each. The generated index size was 2,012 bytes.

The HTTP server returned status 200 and the required headers:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: same-origin`

## Automated baseline

`build/browser-regression.html` now performs the same index and quant commands without a file picker, using the same packaged Worker/Wasm runtime. It compares exact normalized `abundance.tsv`, deterministic run-info counters, and exact batch matrix text. It also validates the intentional R1/R2 record-count mismatch inside the Worker under a 10-second hard timeout and checks immediate Worker cancellation.

Golden data:

- `abundance.tsv` SHA-256: `C5FACB8E653E9549D3805164E1AD6A669DA3ACC67A1B8A99981FCA4B32ED5E12`
- Generated `transcripts.idx` SHA-256: `AA60882D699ED4F66061F3C0612D58DD4552ABC4AC54DD24E628646E30614BCC`
- `counts_matrix.tsv` SHA-256: `86B6E914062D7DA324C28578EBE6BEF975D491289A851CFDE2168C8E62873E44`
- `tpm_matrix.tsv` SHA-256: `FEB4B6348F79ED55B68E8D51E61844F38634E300395C9AFD85C1E62AF5168084`

## Kallisto native comparison

Not tested. No native kallisto binary was supplied or available. Phase 0 therefore protects the archived browser/Wasm result; it does not claim equivalence to a newly executed native 0.52.0 baseline.

Native comparison remains unavailable only for Kallisto 0.52.0. Native fastp 0.23.4, HISAT2 2.2.3, and featureCounts 2.1.1 baselines were built and executed as recorded below. W5 parses the retained native featureCounts baselines and validates gene TPM separately from the upstream native tools.

## Phase W2 fastp 0.23.4 proof

Pinned upstream commit: `1ffcaed6892832c09c4b4094c201cd4eff8fa622`. A native CLI was built from unmodified source against exact extracted Ubuntu libisal 2.30.0-4 and libdeflate 1.10-2 packages. The Wasm build changes only the gzip backend to Emscripten's pinned zlib 1.3.2. Two consecutive Wasm builds produced identical artifacts:

- `tools/fastp/dist/fastp.mjs`: `fa5c9b8a91bd184533f0a7916a29fbb07e2cb4a995b17f014215b46e9517c8d3` (210,221 bytes).
- `tools/fastp/dist/fastp.wasm`: `40a60c81e6ec1301d95ba0cefca59cd3f4d559a3de33706f158a895979615b8c` (836,920 bytes).

Native and Wasm comparisons passed for exact decompressed cleaned record content/order and these major QC fields: total reads/bases, Q20/Q30 bases and rates, mean read lengths, GC content, filtering categories, adapter cutting, and PE insert-size report fields.

| Fixture | Reads before | Reads after | Bases before | Bases after | Low quality | Too many N | Adapter-trimmed reads | Q30 before / after | GC before / after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| SE | 4 | 2 | 171 | 60 | 1 | 1 | 1 | 0.766082 / 1.0 | 0.403509 / 0.433333 |
| PE (read count) | 8 | 4 | 318 | 160 | 2 | 2 | disabled | 0.874214 / 1.0 | 0.459119 / 0.375 |

The actual Chromium module-Worker integration passed again after W3 changes with cross-origin isolation and WORKERFS: SE 137 ms and PE 114 ms in the final observed run, both exit 0. Malformed FASTQ propagated exit `-1` with the sequence/quality-length error. stdout/stderr were captured, generated JSON/HTML reports were present, cancellation passed, and browser warning/error logs were empty. These tiny-fixture timings are observations, not performance claims.

## Phase W2 HISAT2 2.2.3 proof

Pinned upstream commit: `0d244324f98de541bce04d45c75e83bc3522f7f4`; canonical Git archive SHA-256: `20158b4edfb7f2a2324d0d7f252e9833b2af9b66ec620a59e84adb336f9d4e38`. The unmodified native `hisat2-build-s` created the retained eight-part tiny index from a 240 bp genome plus two-exon GTF. The browser never builds an index.

The first wasm32 result exposed a real portability defect: `1 - refExtent()` underflowed as unsigned `size_t`, producing PE TLEN `±40` instead of native `±120`. The isolated port casts `refExtent()` to signed `TRefOff`; native and Wasm then matched after removing only the path-bearing `@PG` header line:

- SE exonic read: `chrTiny:11`, MAPQ 60, `40M`, NM 0.
- SE spliced read: `chrTiny:61`, MAPQ 60, `20M80N20M`, NM 0, `XS:A:+`.
- PE fragment: flags 99/147, positions 21/181, `40M`, mate fields identical, TLEN `120/-120`, AS/NM identical.
- Native and Wasm summaries both report 100% alignment for SE and PE.

Two consecutive builds were byte-identical:

- `tools/hisat2/dist/hisat2.mjs`: `c35bf7f83c40c88fb64cc2226f9dfb2a4c648b02c645380ccaf1b2f8c5bdf02f` (208,356 bytes).
- `tools/hisat2/dist/hisat2.wasm`: `cc82995c05b1eb1897b7f42d1d0160b160062b02d728a1fd41d577f03afc6f9f` (1,107,968 bytes).

The actual Chromium module-Worker test passed again after W3 changes with cross-origin isolation and WORKERFS: SE 112 ms and PE 114 ms in the final observed run, both exit 0. stdout/stderr and exact arguments were captured; cancellation passed after the outer Worker entered the running state. Browser warning/error logs were empty.

## Phase W2 Subread/featureCounts 2.1.1 proof

Official source archive SHA-256: `6392d7c66831cdd767e58251892a79a51b6fab8ed0ba9671ad5e85ff1ab01eaa`. A native featureCounts CLI was built with gcc 11.4. The isolated Wasm patch changes only stdio portability, browser-inapplicable host file-limit probes, captured terminal coloring, and output module naming; read assignment and counting logic are unchanged.

Native and Wasm results match exactly after normalizing only path-bearing command/sample headers:

| Fixture | Annotation | Counting unit | Gene | Length | Raw count | Assigned |
|---|---|---|---|---:|---:|---:|
| SE | GTF | reads | `g1` | 160 | 2 | 2 |
| PE | GTF | fragments (`-p --countReadPairs`) | `g1` | 160 | 1 | 1 |
| SE | GFF3 | reads | `g1` | 160 | 2 | 2 |

Gene order, chromosome/start/end/strand fields, and every assignment-summary category matched. Two consecutive builds were byte-identical:

- `tools/featurecounts/dist/featureCounts.mjs`: `7a184391ea93a5ae343b01586144e18e0b82dcadc67b27de35cc7913d9255e70` (227,110 bytes).
- `tools/featurecounts/dist/featureCounts.wasm`: `c8f18b36dd0d1a30e4250d313df4c52229d05adf7e6562f365621b8f721262ec` (293,120 bytes).

The actual Chromium module-Worker test passed again after W3 changes for GTF SE, GTF PE, and GFF3 SE with exit 0, native-equivalent output, cancellation after running state, and no browser warning/error logs. A malformed annotation propagated exit `-1` with stderr and no outputs in the Node integration test.

## Phase W3 browser large-file gate

The selected boundary is WORKERFS for read-only `File` inputs, a dedicated storage Worker plus OPFS for persistence/sharing, and a synchronous Emscripten character device for direct fastp cleaned-FASTQ and HISAT2 SAM output. Workers pass only `{ schemaVersion, entryId }` descriptors; no complete index/SAM byte array is transferred through the main thread or between tool Workers.

The final observed cross-origin-isolated Chrome 151.0.0.0 run on Windows x64 (16 logical processors reported) passed with no browser warning/error logs:

| Measurement | Result |
|---|---:|
| Synthetic OPFS write | 67,108,864 bytes; 474.55 ms; 134.87 MiB/s; 1 MiB maximum write |
| Write responsiveness | 32 main-thread heartbeats; 17.18 ms maximum gap; no reported long task |
| Cross-Worker OPFS read | 67,108,864 bytes; 232.77 ms; 274.95 MiB/s; 2 MiB maximum stream chunk |
| Read responsiveness | 14 main-thread heartbeats; 16.91 ms maximum gap; no reported long task |
| Integrity | write/read incremental FNV-1a `f11c9dc5` |
| Quota | 10,737,418,576-byte quota; 336-byte starting usage; required+64 MiB headroom accepted |
| Insufficient storage | available+1 byte rejected before allocation |
| Hosted-file path | 4,194,805-byte same-origin `.ht2` part; 2 MiB source chunk bounded to five OPFS writes of at most 1 MiB |

The page wrote a committed 64 MiB entry and an intentional 1 MiB incomplete entry, then reloaded. A fresh Worker retained the ready entry and deleted the incomplete one. During a planned 256 MiB write, terminating the Worker rejected the operation with `AbortError`; a fresh Worker removed the partial entry. Final cleanup reported zero remaining W3 test entries.

The actual W2 engines also passed through this boundary: fastp wrote a 70-byte cleaned gzip directly to OPFS; eight tiny index parts were fetched into OPFS and reopened by HISAT2; HISAT2 wrote a 556-byte SAM directly to OPFS without returning it in the result message; a separate featureCounts Worker reopened the SAM and produced `g1`, Length 160, raw count 2. These tiny outputs validate plumbing and native-equivalent semantics, not large-data performance.

The W3 gate passes for the architecture choice. Multi-GiB biological inputs, production catalog checksums, CDN headers, storage eviction, Firefox, and Safari remain untested.

## Phase W4 hosted HISAT2 index catalog gate

W4 adds a JSON Schema, explicit environment configuration, and a local-test catalog for the existing synthetic `chrTiny` HISAT2 2.2.3 index. The browser still never runs `hisat2-build`. The manifest records exact build arguments, all eight `.ht2` parts plus the GTF, their sizes and SHA-256 values, assembly/contigs, annotation defaults/version, sources, licenses, and creation time. Production remains explicitly unconfigured; no placeholder production URL was added.

The dependency-free Node contract test independently read and hashed all nine artifacts (4,203,807 bytes total), compared the incremental JavaScript SHA-256 implementation with Node crypto across block-boundary/chunk combinations, and proved that changing either the exact HISAT2 version or any index checksum changes the cache key.

The final observed cross-origin-isolated Chrome 151.0.0.0 run on Windows x64 passed with no browser warning/error logs:

| Measurement | Result |
|---|---:|
| Hosted package | 9 artifacts; 4,203,807 payload bytes; all size/SHA-256 checks passed |
| Cache identity | `synthetic-chrtiny-hisat2-2.2.3-v1-31bdf4e03e47b64e7d9b4afe5c43fd4af6d82c6237a34d12e4429d0532f4f263` |
| Retry download | 467.37 ms; 2 MiB maximum source chunk; 1 MiB maximum OPFS write |
| Download responsiveness | 29 main-thread heartbeats; 17.43 ms maximum gap; no reported long task |
| Reload verification | all 9 files re-hashed; 2 MiB maximum read chunk; `chrTiny` annotation/index compatibility passed |
| Verify responsiveness | 7 main-thread heartbeats; 17.62 ms maximum gap; no reported long task |
| Quota preflight | 10,737,418,936-byte quota; 696-byte usage; available+1 byte rejected |
| Cache usage/delete | 4,206,410 bytes reported and freed, including transaction metadata |

Terminating the download Worker after its first persisted chunk rejected the request with `AbortError`. A new Worker removed that `partial.json` entry and the retry committed successfully. After a real page reload, a new Worker retained the ready entry and re-hashed all files. Flipping one byte in `tiny.2.ht2` without changing its size produced `IntegrityError` and automatic whole-entry deletion. A manifest with an incorrect file checksum also failed with `IntegrityError`, left no partial entry, and a subsequent valid retry succeeded. Final explicit deletion left zero W4 reference entries.

The product Home page kept the experimental analysis button disabled and exposed a separate hosted-reference cache link. In the actual cache UI, Download / verify stored and displayed the 4.01 MiB package, a second click reported full re-verification, and Delete returned the selected state to Not cached/696 B total browser usage while disabling deletion. The UI and W4 gate produced no browser warning/error logs.

This gate validates the hosted-package and cache state machine for the tiny same-origin fixture. It does not validate a production CDN, multi-GiB assembly, storage eviction behavior, or W5 engine orchestration.

## Phase W5 end-to-end HISAT2 Web gate

W5 connects the W4 checksum-verified hosted package to sequential dedicated fastp, HISAT2, and featureCounts Workers through the W3 file-backed boundary. The product form supports multiple SE or PE samples, `.fastq`, `.fq`, `.fastq.gz`, and `.fq.gz`; fastp is optional and defaults OFF; threads are explicitly restricted to 1–4. It records the exact tool arguments, stdout/stderr, stage and total timings, annotation parameters, read/fragment counting unit, assignment summary, contig check, TPM denominator/warnings, and optional fastp before/after QC.

The dependency-free Node W5 contract test parsed the retained native featureCounts results as `g1`, Length 160, count 2 for SE reads and count 1 for PE fragments. It independently passed the exact double-precision formula `count / Length / sum(count / Length) * 1,000,000`, producing TPM 1,000,000; zero denominator produced finite zeros with an explicit warning; zero/negative/non-finite Length was rejected. Gene ID, Length, and order were preserved in counts and TPM matrices. Duplicate/empty/Unicode sample-name handling, extensions, R1/R2 name matching, and Worker storage markers also passed.

The final fresh Chrome 151 W5 gate observed:

| Workflow | Result |
|---|---:|
| Hosted fixture | HISAT2 2.2.3; 4,203,807 verified bytes |
| Two-sample SE batch | 1,886.88 ms; each `g1` count 2, Length 160, TPM 1,000,000; exact counts/TPM matrices |
| Raw `.fq.gz`, fastp OFF | 1,454.68 ms; `g1` count 2; no retained decompressed FASTQ |
| PE fragment workflow | 1,147.58 ms; `g1` count 1; featureCounts used `-p --countReadPairs`; result labelled `fragments` |
| fastp ON | 1,845.33 ms; before/after 2 reads; cleaned gzip + JSON/HTML available; retained cleaned FASTQ then explicitly deleted |
| Malformed FASTQ | Rejected during preflight for sequence/quality-length mismatch |
| Zero-assigned configuration | featureCounts nonzero exit was rejected; cleanup left zero W5 entries |
| Running-state cancellation | Issued after HISAT2 reported running; rejected with `AbortError`; cleanup completed |
| Final storage | 0 W5 job entries; W4 fixture cache explicitly removed |

Every successful sample exposes `counts.tsv`, `counts_with_tpm.tsv`, raw featureCounts output/summary, HISAT2 summary, `run_info.json`, and non-empty tool logs where emitted. fastp files exist only when selected. Multi-sample runs expose counts/TPM matrices and `batch_manifest.json`; the UI separately downloads the result-manifest contract. SAM is never a default download and is removed after featureCounts. Mapped-contig mismatch and a zero-assigned result with mapped records are explicit non-success errors.

This is a small synthetic acceptance, not a production-scale claim. A production HTTPS catalog/CDN, reference provenance and licensing approval, representative biological agreement, multi-GiB behavior, storage eviction, and measured peak browser memory remain W6 work.

## Phase W6 Web validation — in progress

The fresh cross-origin-isolated Chrome 151 run on Windows x64 passed the archived Kallisto regression, the complete W5 HISAT2 fixture gate, and the new W6 gate. Kallisto fastp defaults OFF. The small paired fixture produced the exact archived abundance and run counters with fastp OFF and ON; fastp reported four reads before/after, exposed its exact arguments and reports, retained two cleaned mates, and deleted both on request. Cancelling fastp after its running event rejected with `AbortError` and left zero `w6-kallisto-*` OPFS entries.

The same gate returned distinct, understandable failures for insufficient storage (`QuotaPreflightError`), a reference at the conservative 1.5 GiB Web envelope (`WebResourceLimitError`), an incorrect hosted index checksum (`IntegrityError: SHA-256 mismatch`), and an annotation/index contig mismatch (`IntegrityError: Declared annotation contig ... was not found`). On the final 2026-08-20 rerun, browser storage was 696 bytes before and after the small W6 gate. The main-page JS heap observation changed from 13,489,389 to 14,793,032 bytes; this is a tiny-gate observation, distinct from the 268,435,456-byte Wasm allocation reported by each small Kallisto run.

The user-supplied representative Kallisto inputs were read directly from `example_data` and locked by size/SHA-256 in `tools/w6-validation/example-data.lock.json`:

| Observation | Chrome 151 result |
|---|---:|
| cDNA FASTA | 90,392,408 bytes; 54,715 records |
| Generated Kallisto index | 141,751,322 bytes (135.2 MiB); 201 sec; 209,567 graph contigs; 47,602,966 k-mers |
| Index Wasm linear-memory high water | 1,120,010,240 bytes (1.04 GiB; UI label is 1.04 GB) |
| Paired gzip FASTQ | 3,102,512,503 bytes total |
| Quantification | 882 sec total; one thread; fastp OFF |
| Processed / pseudoaligned | 23,809,408 / 23,373,083 (98.167426%) |
| Quantification Wasm linear-memory high water | 747.8 MiB rounded UI observation |
| Pseudoalignment worker | 214 batches; 605.396 sec; one active read worker; 32 MiB read batch and 1 MiB gzip buffer |
| EM | 1,174 rounds |
| Outputs | `abundance.tsv`, `run_info.json`, `browser_performance.json`, `counts_matrix.tsv`, `tpm_matrix.tsv` |

The tracked instantiation hook captures the shared imported `WebAssembly.Memory`. Wasm memory grows monotonically and does not shrink, so its final `buffer.byteLength` is a per-Worker linear-memory allocation high water. This is not browser-process or operating-system resident memory. The generated `browser_performance.json` contains the unrounded byte value; the in-app validation browser did not persist the quantification download externally, so the frozen report records the observed 747.8 MiB UI value without inventing an exact byte count. The instrumented small Kallisto regression and W6 fastp OFF/ON gate both reported the expected 268,435,456-byte initial/high-water allocation.

This proves that this particular multi-GiB Kallisto dataset completes in the tested browser and closes the previously open representative Kallisto Wasm-allocation measurement sub-gate. It does not create a general multi-GiB support promise. The generated index and standard Kallisto outputs remain memory-backed. The earlier 2026-08-18 index was 141,752,090 bytes, 768 bytes larger than the fresh build, while both reported 209,567 graph contigs and 47,602,966 k-mers; byte-for-byte determinism is therefore not claimed for this representative index build.

The example dataset includes `Col-CC_v2_genome.fasta.gz` and `TAIR12_1Feb26.gff3.gz`; both declare the matching `Chr1`–`Chr5` contigs. It still has no exact-version prebuilt HISAT2 index, native expected alignment/featureCounts/TPM output, or approved production catalog/CDN. It therefore cannot yet validate representative HISAT2 biology or hosting. Firefox and Safari also remain unmeasured. W6 is not complete and Desktop Phase D1 must not start.

## Memory, storage, and runtime

- Kallisto Wasm hard maximum linear memory from the audited link command: 3 GiB.
- Tiny generated index: 2,012 bytes.
- Browser capability panel reports the quota values exposed by `navigator.storage.estimate()`; these values are environment-specific and are not a large-data benchmark.
- A generated 64 MiB storage artifact was measured in W3. Representative Kallisto runtime and Wasm linear-memory allocation high water are now measured as described above; browser-process/OS resident memory is not. Representative biological HISAT2 memory, storage, and runtime remain not tested.
- fastp-Wasm link bounds: 256 MiB initial shared linear memory, growth enabled, 2 GiB maximum. Actual peak memory was not measured; W5 streams cleaned FASTQ to OPFS, but only the tiny fixture has been exercised end to end.
- HISAT2-Wasm link bounds: 256 MiB initial shared linear memory, growth enabled, 2 GiB maximum, 16 MiB stack, four-worker pthread pool. The tiny eight-part index and SAM were proof artifacts only; actual peak memory and large-index behavior were not measured.
- featureCounts-Wasm link bounds: 128 MiB initial shared linear memory, growth enabled, 2 GiB maximum, 8 MiB stack, four-worker pthread pool. The tiny SAM/annotation/output path used Worker-local files; large SAM handoff and peak memory were not measured.

## Cancel and cleanup

- Existing Kallisto Stop implementation terminates the Worker, discarding its temporary Emscripten filesystem.
- Automated immediate Worker cancellation expects `Analysis stopped by user.`.
- Intentional paired-file mismatch is structurally confirmed and then rejected by the actual Worker/Wasm path under a hard timeout.
- fastp cancellation passed in Node and Chromium after the Worker reported the running state. Termination rejected with `AbortError` and discarded the Worker-local runtime/MEMFS; Node returned without a hanging pthread Worker.
- HISAT2 and featureCounts cancellation passed in Node and Chromium after each outer Worker reported the running state. Termination discards the proof runtime and its temporary MEMFS state.
- W4 checksum-addressed multi-file ready/partial cleanup, cancel/retry, reload re-hash, corruption invalidation, and explicit deletion passed.
- W5 termination of an actively running HISAT2 Worker rejected with `AbortError`; retry-aware cleanup removed the partial SAM and every job-prefixed temporary entry. Successful runs remove SAM and temporary decompressed FASTQ; cleaned fastp FASTQ is retained only for user download and can be explicitly deleted.

## Platform support claims

- Chromium: tiny Kallisto path, isolated fastp/HISAT2/featureCounts proofs, the W3 64 MiB OPFS/file-backed handoff, W4 local catalog/cache, and W5 experimental end-to-end synthetic workflow tested in Chrome 151.
- Firefox: not tested; Firefox was not installed in the Windows validation environment on 2026-08-20.
- Safari: not tested; Safari requires a separate macOS validation environment and is unavailable on the current Windows host.
- Windows/macOS/Linux desktop packages: not built and not tested.

## Post-change stable-product validation

- Static file, matrix, Worker lifecycle/cache-version, contract/capability, product-shell, W5 preflight/result, and deployment-header checks: passed.
- Actual Kallisto browser/Wasm regression: passed again after W5, including exact 2,012-byte index SHA-256, exact abundance/matrices, 2 processed, 2 pseudoaligned, Worker/Wasm mismatch rejection, and Worker cancellation.
- Capability observation in the tested Chromium environment: all W1 browser APIs detected; quota estimate 10 GiB with approximately 10 GiB available at check time. This is an observation, not a minimum support promise.
- The W5 form was visually inspected at desktop width with all navigation, Experimental/local-test boundary, three status cells, and reference controls visible without clipping; PE and fastp toggles exposed R2 and exact `--countReadPairs`/cleaned-output arguments.

## W2–W6 scope statement

All three W2 individual-engine acceptances, the measured W3 storage-architecture gate, W4 local hosted-package/cache acceptance, W5 small end-to-end pipeline, and the completed W6 sub-gates above have passed. The product UI keeps fastp OFF by default and enables HISAT2 only as Experimental with a synthetic local catalog warning. One representative multi-GiB Kallisto run completed with measured Wasm linear-memory allocation high water. Production HISAT2 hosting/biology, Firefox, and Safari remain release blockers. Phase W6 Web release validation is in progress; no desktop release exists.
