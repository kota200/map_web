# Web Wasm Pipeline

## Current stable implementation

Kallisto 0.52.0 is invoked through `Module.callMain()` in a dedicated Worker. Inputs are File/Blob-backed WORKERFS mounts. A batch mounts the reference once and mounts each sample into a private directory sequentially. Results are returned after each sample and matrix construction verifies target count, ID, duplicates, and order.

The current output set is:

```text
sample:
  abundance.tsv
  run_info.json
  browser_performance.json
batch:
  counts_matrix.tsv
  tpm_matrix.tsv
optional:
  generated transcriptome .idx
```

Stop terminates the Worker. There is no persistent filesystem in the stable path.

## W2 engine boundary

Each engine is now a separate reproducible Emscripten 6.0.6 build with its own Worker adapter, pinned upstream source, isolated portability patch, native baseline, stdout/stderr capture, exit-code propagation, and cancellation test.

The independent CLI proofs are under `tools/fastp`, `tools/hisat2`, and `tools/featurecounts`. They remain separate runtimes.

## W3 file boundary

W3 selects WORKERFS for read-only `File` inputs and OPFS for persistent/shared artifacts. A small Emscripten device adapter sends synchronous POSIX writes from fastp cleaned FASTQ and HISAT2 `-S` output to an OPFS sync access handle in bounded chunks. Each tool remains in its own outer Worker and passes only an entry descriptor; the next Worker reopens the committed OPFS file and mounts it read-only.

The 64 MiB persistence/reload/cancel gate and the actual tiny fastp → storage plus HISAT2 → storage → featureCounts boundaries pass. The product route is still disabled because W5 typed pipeline integration does not exist.

## W4 hosted reference boundary

The local test catalog records the exact HISAT2 2.2.3 build, assembly/contigs, eight index components, GTF defaults, sources/licenses, sizes, and SHA-256 values. A dedicated Worker streams these nine artifacts into a single OPFS transaction. It publishes `ready.json` only after size, checksum, and annotation-contig checks pass; partial or corrupt entries are deleted as a unit. The cache key includes reference ID, HISAT2 version, and every checksum. The production catalog URL remains explicitly unconfigured.

## Planned BrowserRunner

The BrowserRunner will accept `contracts/analysis-job.schema.json`, emit `contracts/runtime-event.schema.json`, and return `contracts/result-manifest.schema.json`. It must never accept a raw shell command string. Argument arrays are created from validated UI state and recorded before execution.

Kallisto can be adapted to this boundary incrementally; W1 does not rewrite its proven Worker path.
