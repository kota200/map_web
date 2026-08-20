# Desktop Pipeline (D1)

Status: implementation in progress. The Rust core and Tauri commands compile on
Windows x64, but D1 cannot be accepted until verified production Windows sidecars
and a packaged-app integration test are present.

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
record must name the Tauri target-specific executable and record its version,
SHA-256, upstream source URL, license, and bundled license-text path. The
manifest now registers the official Subread featureCounts 2.1.1 Windows x64
executable, including its SHA-256, source URL, GPL license text, and a
successful local `-v` runtime probe plus the retained SE SAM/GTF fixture
(`g1`, Length `160`, Count `2`, Assigned `2`). fastp 0.23.4 and HISAT2 2.2.3 remain
unregistered until `.github/workflows/windows-sidecars.yml` builds and validates
them from their fixed source locks. Do not substitute PATH, WSL, Python/Perl
wrappers, or unverified binaries. HISAT2 and Subread are GPL-3.0-or-later;
their source and notices must accompany a release. See `THIRD_PARTY_NOTICES.md`.

## Developer verification

From `desktop/src-tauri` run `cargo fmt --check`, `cargo test`, and
`cargo check --features desktop`. Current tests cover typed planning, index
publication/manifest hashes, TPM math, sidecar path rejection, and orphan
cleanup. They do not run a biological sidecar or a packaged Tauri app.
