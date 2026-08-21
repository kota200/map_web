# Desktop Pipeline (D1)

Status: complete on Windows x64. GitHub Actions run
[`32385204268`](https://github.com/kota200/map_web/actions/runs/32385204268)
is the acceptance record for commit `0a5e40b`: verified production sidecars,
real Tauri application launches, Rust tests, and the complete `desktop` feature
build all passed.

```text
shared UI / schemas / scientific calculations
  ├─ BrowserRunner: Workers + Wasm + browser storage
  └─ DesktopRunner: typed Tauri commands + Rust ProcessSupervisor + bundled binaries
```

## Execution boundary

The frontend supplies typed requests only; it cannot provide a program, shell
command, or raw argument string. Rust validates absolute non-traversing paths,
creates argument arrays, verifies each binary SHA-256 against the target
manifest before any launch, and invokes it without a shell. `native-log` emits
capped 4 KiB stdout/stderr lines; FASTQ, FASTA, SAM, and full logs are never
sent through the WebView. Windows cancellation uses `taskkill /PID <pid> /T /F`.

## Pipeline results and temporary recovery

The pipeline stages files at `<output>/.rna-seq-tmp/<run UUID>`. After
featureCounts succeeds, D1 validates its output, writes `counts.tsv`
(`Geneid`, `Length`, `Count`) and `counts_with_tpm.tsv` (`Geneid`, `Length`,
`Count`, `TPM`), requires `featureCounts.txt.summary`, cleans SAM and cleaned
FASTQ unless `Keep SAM` is set, then atomically renames the complete directory
to `<output>/<run UUID>`. TPM uses `f64`: `count / Length / sum(count / Length)
* 1e6`; feature order is retained. Invalid Length/count, empty output, and a
zero denominator fail rather than emitting NaN or Infinity.

Failures and cancellation delete the UUID staging directory. The
`find_orphan_temporary_directories` and `cleanup_orphan_temporary_directories`
commands only enumerate/remove UUID-named direct children of `.rna-seq-tmp` and
`.rna-seq-index-tmp`; links and other paths are ignored.

## Custom index build

`start_hisat2_index_build` builds `<cache>/<index name>/index` in
`<cache>/.rna-seq-index-tmp/<build UUID>/index`. On success, all eight `.ht2`
or `.ht2l` files are required; the temporary directory is given an
`index-manifest.json` and atomically renamed to `<cache>/<index name>`. Existing
completed index directories are never overwritten. The manifest contains FASTA
basename/size/SHA-256, HISAT2 version, exact arguments, index parts with
sizes/SHA-256, UTC timestamps, and the validation result.

## Sidecar release gate

`src-tauri/binaries/sidecars.windows-x86_64.json` is fail-closed. A production
record names the Tauri target-specific executable and records version, SHA-256,
source URL/revision, build provenance, license identifier, license path/hash,
and every support helper.

The manifest registers fastp 0.23.4, HISAT2 and hisat2-build 2.2.3, and the
official Subread featureCounts 2.1.1 Windows x64 executable. CI builds fastp
and HISAT2 from fixed commits, uses checked-in script-free dispatchers, rejects
all `/ucrt64/bin` DLL imports, records exact static-library package and license
metadata, and checks all four native version commands including exit status.
Do not substitute PATH, WSL, Python/Perl wrappers, or unverified binaries.

HISAT2 and Subread are GPL-3.0-or-later. The matching source archives and
checksums are committed at `desktop/corresponding-source/windows-x64`; the
build workflow and dispatcher source remain in this repository. Preserve these
materials and all bundled notices alongside a public binary release. This is
an engineering control, not legal advice; public distribution still requires
legal review. See `THIRD_PARTY_NOTICES.md`.

## Developer verification

The authoritative clean Windows verification is
`.github/workflows/windows-sidecars.yml`. It performs:

1. fixed-revision source retrieval and Subread source SHA validation;
2. static Windows sidecar builds and a zero-MSYS2-DLL gate;
3. exact version/exit-code probes and manifest/license generation;
4. `cargo fmt --check` and Rust core tests;
5. `cargo test --features desktop --test bundled_sidecars`, which launches all
   four registered tools from the compiled Tauri application; and
6. `cargo build --features desktop` plus artifact/source upload.

For a machine whose endpoint policy blocks locally built or unsigned Rust
executables, do not whitelist or repeatedly retry them merely for D1. Push the
scoped branch and use the clean GitHub-hosted Windows runner evidence instead.

The generated artifacts are named `desktop-sidecars-windows-x64`,
`desktop-sidecars-windows-x64-corresponding-source`, and
`desktop-tauri-windows-icon`. Before replacing committed binaries, compare the
downloaded executable, helper, license, manifest, and source hashes and confirm
that the package contains zero `.dll` files.

## D1 acceptance checklist

- HISAT2 index build is supervised and atomically finalized.
- Index manifest contains FASTA hash, HISAT2 version, exact arguments, files,
  sizes, hashes, and UTC timestamps.
- featureCounts output produces raw counts, Length, TPM, and summary artifacts.
- UUID orphan staging discovery and cleanup commands are exposed.
- Windows x64 sidecars have version, SHA-256, origin, license, and build
  provenance records; static dependency notices are included.
- The compiled Tauri application launches every bundled sidecar in CI.
- Rust core tests and the full `desktop` feature build pass.
