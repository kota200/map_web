# Desktop Pipeline (D1 and D2 engineering acceptance complete)

Status: D1 is complete on Windows x64. The merged `main` acceptance record is
GitHub Actions run
[`32437427175`, attempt 2](https://github.com/kota200/map_web/actions/runs/32437427175):
verified production sidecars, real Tauri application launches, Rust tests, and
the complete `desktop` feature build passed. Attempt 1 failed only because a
SourceForge mirror timed out; D2 adds bounded retry for those fixed downloads.

D2 passed at commit `cbe1adff0a0b5b2af1b4b9dc730412648925c1de` in
[Windows run `32446706845`](https://github.com/kota200/map_web/actions/runs/32446706845)
and
[cross-platform run `32446706737`](https://github.com/kota200/map_web/actions/runs/32446706737).
All four target jobs completed their native scientific regression, manifest and
license packaging, Tauri bundled-sidecar launch, unsigned installer build, and
artifact upload gates. This is engineering acceptance, not public-release
approval.

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

`src-tauri/binaries/sidecars.x86_64-pc-windows-msvc.json` is fail-closed. A production
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

## D2 native Kallisto boundary

`plan_kallisto_run` accepts a typed transcriptome-index request and builds only
`fastp` and `kallisto quant` argument arrays. Paired-end mode rejects fragment
distribution fields; single-end mode requires positive finite mean and standard
deviation values. Kallisto never receives HISAT2, SAM, annotation, strandedness,
or featureCounts settings.

The supervisor verifies every requested sidecar before creating the UUID staging
directory, streams capped/redacted logs, tracks the child process for cancellation,
and validates the exact Kallisto table header, numeric values, unique target IDs,
and required `run_info.json` fields. It removes temporary cleaned FASTQ files,
writes `desktop-run-manifest.json` without absolute input paths, and atomically
renames the complete result directory. Expected published outputs are
`abundance.tsv`, `run_info.json`, optional plaintext bootstrap TSV files, and the
desktop manifest.

The desktop chooser states the scientific boundary explicitly:

- Kallisto is transcript-level pseudoalignment/abundance against a transcriptome
  index.
- HISAT2 + featureCounts is genome alignment followed by annotation-aware
  gene/feature counting.

The UI calls `verify_sidecars` at startup and disables engines not fully present
in the target manifest. A target-specific manifest must match the Rust compile
target exactly; a copied manifest from another platform is rejected.

## D2 platform artifacts and release status

The Windows workflow builds Kallisto 0.52.0 from commit `4e9f29c` using the
checked-in transformation derived from upstream's own Windows recipe. It records
the exact patch, unmodified source archive, binary hash, Kallisto/Bifrost/zlib-ng
licenses, native version evidence, scientific fixture result, and an unsigned
NSIS installer checksum.

`kallisto-platforms.yml` independently builds portable native Kallisto on:

| Target | Runner | Tool gate | Unsigned bundle requested |
|---|---|---|---|
| `x86_64-unknown-linux-gnu` | Ubuntu 22.04 x64 | version, architecture, index + PE quant, exact abundance | `.deb` and AppImage |
| `aarch64-apple-darwin` | macOS 15 arm64 | version, architecture, index + PE quant, exact abundance | DMG |
| `x86_64-apple-darwin` | macOS 15 Intel | version, architecture, index + PE quant, exact abundance | DMG |
| `x86_64-pc-windows-msvc` | Windows Server 2022 x64 | version, SHA, Tauri launch; native regression is a D2 gate | NSIS |

These are CI test artifacts, not public releases. All four jobs passed on
2026-08-21, and each uploaded package contains generated hash inventories for
review. A public
macOS download requires Developer ID signing and notarization; a public Windows
installer requires an approved Authenticode signing identity and protected CI
secret/key service; Linux publishes separate `.deb` and AppImage formats and
needs its own signature/repository policy. No signing credentials are committed.

## D2 acceptance and artifact-review procedure

1. Confirm both authoritative runs completed successfully at the same head SHA:
   `cbe1adff0a0b5b2af1b4b9dc730412648925c1de`.
2. In `32446706845`, confirm the native Kallisto golden regression, version
   checks for all five Windows tools, manifest/license packaging, compiled Tauri
   sidecar integration test, complete `desktop` feature build, and unsigned NSIS
   step all passed.
3. In `32446706737`, confirm the three target jobs report the expected runner
   architecture, exact native `abundance.tsv` regression, Tauri Kallisto launch,
   and unsigned DMG or DEB/AppImage build.
4. Download artifacts only on a trusted validation/release machine. Verify
   `SHA256SUMS`, the target-specific installer checksum file, and the source
   checksum file before inspecting or executing a binary. On a host whose
   endpoint policy blocks locally built or unsigned tools, do not whitelist the
   artifacts merely to repeat CI.
5. Keep each binary/installer beside its exact source archive, generated patch,
   checksum inventory, and complete license directory. Do not combine manifests
   from different Rust targets or strip GPL corresponding-source materials from
   the full Windows package.
6. Treat every installer as unsigned CI evidence. A release owner must complete
   platform signing/notarization, legal review, protected-key handling, and a
   post-signature installation test before publication.

The successful run exposes these artifact families:

- Windows: `desktop-sidecars-windows-x64`,
  `desktop-sidecars-windows-x64-corresponding-source`, and
  `rna-seq-local-unsigned-installer-windows-x64`.
- Per Linux/macOS target: `kallisto-sidecar-<target>`,
  `kallisto-source-<target>`, and
  `rna-seq-local-unsigned-installer-<target>`.

Current packaging guidance is based on the official Tauri documentation:
<https://v2.tauri.app/distribute/> and
<https://v2.tauri.app/start/prerequisites/>.

## D2 acceptance checklist

- [x] Windows x64 native Kallisto build, scientific regression, Tauri launch,
  and unsigned NSIS generation pass in clean CI.
- [x] macOS arm64 native Kallisto regression and unsigned DMG generation pass.
- [x] macOS x64 native Kallisto regression and unsigned DMG generation pass.
- [x] Linux x64 native Kallisto regression plus `.deb` and AppImage generation
  pass on the documented compatibility baseline.
- [x] Every artifact has a target-specific manifest, exact SHA-256, source
  revision/archive, full license texts, and build provenance.
- [x] Signing/notarization remains visibly blocked until real credentials and a
  release owner are approved; unsigned CI artifacts are never called releasable.
