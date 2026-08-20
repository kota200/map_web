# Desktop D1

Tauri 2 native HISAT2 MVP boundary. The Web UI may reuse the shared result
model, but only typed Rust commands create native argument arrays and launch
approved sidecars. No shell command string is accepted from the frontend.

Windows sidecars are deliberately not committed until their version, license,
checksum, and provenance are recorded. `cargo test` validates the command and
path contracts without executing a biological tool.

The Tauri invoke surface is intentionally narrow:

- `plan_hisat2_run` constructs a typed plan only.
- `verify_sidecars` verifies each approved binary before any launch.
- `start_hisat2_run` validates every binary in the plan first, then supervises
  the sequential fastp / HISAT2 / featureCounts process chain.
- `get_run_status` returns a compact state record; output files remain local.
- `cancel_run` terminates the active Windows process tree with `taskkill /T`.
- `start_hisat2_index_build` executes a verified `hisat2-build` sidecar,
  validates all eight parts, writes its provenance manifest, and atomically
  publishes the index directory.
- `find_orphan_temporary_directories` and
  `cleanup_orphan_temporary_directories` recover UUID-owned staging paths after
  an interrupted run.

The Rust supervisor reads stdout and stderr concurrently and emits each line as
the `native-log` Tauri event (`run_id`, tool, stream, line). Lines are capped
at 4,096 characters and are forwarded immediately; the supervisor never builds
an in-memory full-process log or transfers FASTQ/SAM content to the WebView.

`src-tauri/binaries/sidecars.windows-x86_64.json` is a fail-closed manifest.
D1 currently registers and runtime-verifies only the official featureCounts
2.1.1 Windows x64 executable; the fastp and HISAT2 records remain absent until
the reproducible Windows build workflow has produced and validated them. The
tool validates paths, checksums, registered support files, and the entire plan
before the first native process starts.

Each native run stages its FASTQ derivatives, SAM, and provisional
featureCounts files under `output/.rna-seq-tmp/<run UUID>`. Successful output
is validated into `counts.tsv` and `counts_with_tpm.tsv`, retains raw
featureCounts output and its summary, then atomically becomes
`output/<run UUID>`. Partial artifacts are removed after a failure or
cancellation; `Keep SAM` retains SAM in that successful result directory.
