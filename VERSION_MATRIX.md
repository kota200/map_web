# Version Matrix

Date audited: 2026-08-21

| Component | Web version/status | Desktop version/status | Source evidence | Toolchain / flags |
|---|---|---|---|---|
| kallisto | 0.52.0, packaged and tested | D2 native 0.52.0 runner and unsigned packages passed clean CI on Windows x64, Linux x64, macOS arm64, and macOS x64 | `vendor/kallisto` tag `v0.52.0`, commit `4e9f29cf3b021260415430c057a22469ca081391`; D2 runs `32446706845` and `32446706737` | Web: Memory64/pthread/O3; desktop: HDF5/BAM off, plaintext bootstrap output, portable platform flags, exact binary SHA in generated manifest |
| Kallisto Web/Desktop wrapper | `v10.4-batch` baseline + Phase W1 product shell | Typed Kallisto request/supervisor, output validation, privacy manifest, and engine-separated desktop UI implemented | `kallisto/build-info.txt`, `desktop/src-tauri/src/kallisto.rs`, `desktop/frontend` | Browser Worker/WORKERFS versus native verified sidecar; no raw shell surface |
| zlib-ng | `2.1.0.devel` vendored, packaged in Wasm | D2 native Kallisto build enables the pinned bundled tree; license/hash is registered per platform artifact | `vendor/kallisto/ext/zlib-ng/zlib.h.in` and clean v0.52.0 source | Static Kallisto component; exact license SHA in sidecar manifest |
| Bifrost | Vendored with kallisto; patched for Wasm | D2 native Kallisto uses the Bifrost tree bundled at the pinned Kallisto revision | `vendor/kallisto/ext/bifrost` and clean v0.52.0 source | Static Kallisto component; BSD-2-Clause notice registered |
| Emscripten (archived Kallisto) | Exact version unavailable; archived binary only | N/A | Build paths and link flags preserved, version absent | Archived Kallisto reproducibility risk remains |
| Emscripten (W2 proofs) | 6.0.6, built and tested | N/A | Compiler commit `ce75e06884093bcefb86a6b8fd56a5d62a4cc245`; emsdk commit `bfce6709931a9381d91e6cd75c422dec2188fbf2` | Separate pthread module Workers; exact per-tool flags in artifact locks |
| W3 browser storage boundary | Chromium OPFS/WORKERFS gate passed at 64 MiB measured scale | N/A | Uses the unchanged W2 Emscripten 6.0.6 artifacts | Dedicated-Worker OPFS sync handles, legacy Emscripten FS device output; Firefox/Safari and multi-GiB inputs not tested |
| W4 hosted index catalog/cache | Local synthetic HISAT2 2.2.3 package passed; not product-enabled or production-hosted | N/A | JSON Schema plus versioned test manifest; exact hashes of eight `.ht2` files and GTF | Dedicated Worker, streaming fetch, incremental SHA-256, OPFS sync handles; same-origin Chromium only |
| W5 HISAT2 browser workflow | Experimental small-fixture gate passed; production W6 pending | N/A | Two-sample SE, raw `.fq.gz`, PE fragments, fastp ON/OFF, TPM/matrices, cancel/cleanup browser gate | Sequential dedicated Workers; W4 cache + W3 OPFS handoff; Chrome 151 only |
| CMake | 3.22.1 in archived build metadata | Not selected | `.wasm-build/CMakeFiles/3.22.1` | Unavailable on current host PATH |
| fastp | 0.23.4; W2 proof and W5 optional preprocessing passed (default OFF) | Windows x64 0.23.4 sidecar built, SHA-verified, real-launched, and licensed in merged D1 CI | Tag `v0.23.4`, commit `1ffcaed6892832c09c4b4094c201cd4eff8fa622`, canonical archive SHA-256 `43369abc...3c09` | Windows static MSYS2 build; exact dependency packages and licenses recorded in manifest |
| HISAT2 | 2.2.3; W2 proof and W5 experimental workflow passed | Windows x64 HISAT2 and hisat2-build 2.2.3 sidecars built, SHA-verified, real-launched, and licensed in merged D1 CI | Tag `v2.2.3`, commit `0d244324f98de541bce04d45c75e83bc3522f7f4`, canonical Git archive SHA-256 `20158b4e...e38` | Static helpers plus script-free Windows dispatchers; corresponding source committed |
| featureCounts/Subread | 2.1.1; W2 proof and W5 experimental workflow passed | Official Windows x64 2.1.1 sidecar registered, SHA-verified, real-launched, and used by the D1 result pipeline | Official source archive SHA-256 `6392d7c66831cdd767e58251892a79a51b6fab8ed0ba9671ad5e85ff1ab01eaa`; binary inventory in `desktop/src-tauri/binaries/README.md` | Official Windows binary; GPL source/license carried with artifact |
| Tauri | Not applicable | Rust crate 2.11.5 locked; CLI 2.11.4 pinned; D2 unsigned NSIS, DMG, DEB, and AppImage builds passed | `desktop/src-tauri/Cargo.lock`; D2 runs `32446706845` and `32446706737` | Tauri 2 external binaries and target-specific manifests; signing/notarization remains a release blocker |
| Rust | Not applicable | GitHub-hosted target toolchains used for current desktop verification | Merged D1 run `32437427175`; D2 runs `32446706845` and `32446706737` | Local Rust execution remains avoided because endpoint policy blocks the unsigned local toolchain |

## Archived runtime hashes

- `kallisto/kallisto.js`: `2345D8EBBE7D085ACA542586FABDA3E8BEA105294CC2E19398A3A02B84A2B77F`
- `kallisto/kallisto.wasm`: `A0C5E90BD8ABC2C09E3126F2C7CCE1616E31EACDDDF5046FDF36CABB81AEE5AD`

The W2 proof artifact hashes and complete flags are locked in each tool's `artifacts.lock.json`. D1 Windows acceptance is recorded on merged `main`. D2 clean CI passed at commit `cbe1adff0a0b5b2af1b4b9dc730412648925c1de`; each target artifact contains its generated sidecar, installer, and source checksums. These unsigned installers are engineering evidence only and are not release-ready.
