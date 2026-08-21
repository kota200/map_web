# Desktop D1 / D2

Phase D1 provides the Tauri 2 native HISAT2 execution boundary. Phase D2 adds a
separate typed native Kallisto 0.52.0 runner and a desktop chooser that keeps
transcript-level pseudoalignment distinct from genome alignment plus
feature-level counting. The frontend cannot choose a program or pass a shell
command string.

The Tauri invoke surface is intentionally narrow:

- `plan_hisat2_run` constructs a typed plan only.
- `verify_sidecars` verifies registered paths, provenance, licenses, support
  files, and SHA-256 values before launch.
- `start_hisat2_run` supervises fastp, HISAT2, and featureCounts in sequence.
- `plan_kallisto_run` and `start_kallisto_run` supervise optional fastp and
  native Kallisto, validate `abundance.tsv` and `run_info.json`, write a
  privacy-preserving `desktop-run-manifest.json`, and atomically publish the
  result directory.
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

Platform manifests are named `sidecars.<Rust target>.json` and are rejected if
their target does not match the compiled application. D1's Windows manifest
registers fastp 0.23.4, HISAT2/hisat2-build 2.2.3, and featureCounts 2.1.1.
D2 registers Kallisto 0.52.0 plus bundled Bifrost and zlib-ng license evidence.
Linux and macOS sidecars are also placed in a tar archive so executable mode
bits survive GitHub artifact download; the archive receives its own SHA-256.

The authoritative merged D1 evidence is GitHub Actions run
[`32437427175`, attempt 2](https://github.com/kota200/map_web/actions/runs/32437427175).
D2 engineering acceptance passed at commit
`cbe1adff0a0b5b2af1b4b9dc730412648925c1de` in the
[Windows x64 run](https://github.com/kota200/map_web/actions/runs/32446706845)
and the
[Linux x64 / macOS arm64 / macOS x64 run](https://github.com/kota200/map_web/actions/runs/32446706737).
Those runs produced target-specific sidecars, corresponding source, and
unsigned NSIS, DMG, DEB, and AppImage artifacts. They are not public releases;
signing, notarization, and release/legal approval remain external blockers. See
`../docs/DESKTOP_PIPELINE.md` for the acceptance and artifact-review procedure.
