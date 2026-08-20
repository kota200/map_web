# Desktop D1

Phase D1 provides the Tauri 2 native HISAT2 execution boundary. The frontend
can submit typed requests only; it cannot choose a program or pass a shell
command string. The temporary D1 page under `frontend/` is intentionally small
and will be replaced when the desktop workflow UI is connected in the next
phase.

The Tauri invoke surface is intentionally narrow:

- `plan_hisat2_run` constructs a typed plan only.
- `verify_sidecars` verifies registered paths, provenance, licenses, support
  files, and SHA-256 values before launch.
- `start_hisat2_run` supervises fastp, HISAT2, and featureCounts in sequence.
- `get_run_status` returns compact state; `cancel_run` terminates the Windows
  process tree with `taskkill /T`.
- `start_hisat2_index_build` supervises `hisat2-build`, validates all eight
  parts, writes the provenance manifest, and atomically publishes the index.
- `find_orphan_temporary_directories` and
  `cleanup_orphan_temporary_directories` safely recover UUID-owned staging
  paths after an interrupted run.

stdout and stderr are read concurrently and emitted as capped 4,096-character
`native-log` lines. FASTQ, FASTA, SAM, count tables, and complete process logs
are not transferred through the WebView.

Successful runs atomically publish raw featureCounts output, its summary,
`counts.tsv`, and `counts_with_tpm.tsv`. Failure and cancellation remove the
UUID staging directory. `Keep SAM` preserves SAM only after success.

`src-tauri/binaries/sidecars.windows-x86_64.json` registers fastp 0.23.4,
HISAT2/hisat2-build 2.2.3, and featureCounts 2.1.1 with exact version, source,
revision, build provenance, license, and SHA-256 metadata. The Windows package
is statically linked except for operating-system libraries and contains no
MSYS2 runtime DLLs. Corresponding GPL source is stored under
`corresponding-source/windows-x64`.

The authoritative D1 build and real-sidecar integration evidence is GitHub
Actions run
[`32385204268`](https://github.com/kota200/map_web/actions/runs/32385204268).
See `../docs/DESKTOP_PIPELINE.md` for the acceptance and reproduction steps.
