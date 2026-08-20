# Version Matrix

Date audited: 2026-08-17

| Component | Web version/status | Desktop version/status | Source evidence | Toolchain / flags |
|---|---|---|---|---|
| kallisto | 0.52.0, packaged and tested | Not implemented | `vendor/kallisto` tag `v0.52.0`, commit `4e9f29cf3b021260415430c057a22469ca081391`; patched dirty tree | Memory64, pthread, O3, selective LTO/SIMD, zlib-ng, max memory 3 GiB |
| Kallisto Web wrapper | `v10.4-batch` baseline + Phase W1 product shell | Not implemented | `kallisto/build-info.txt`, source files | Static HTML/CSS/ES modules, Worker, WORKERFS |
| zlib-ng | `2.1.0.devel` vendored, packaged in Wasm | Not selected | `vendor/kallisto/ext/zlib-ng/zlib.h.in` | `ZLIB_COMPAT=ON`, selective O3/LTO/SIMD |
| Bifrost | Vendored with kallisto; patched for Wasm | Not selected | `vendor/kallisto/ext/bifrost` | Conservative O3 in archived build |
| Emscripten (archived Kallisto) | Exact version unavailable; archived binary only | N/A | Build paths and link flags preserved, version absent | Archived Kallisto reproducibility risk remains |
| Emscripten (W2 proofs) | 6.0.6, built and tested | N/A | Compiler commit `ce75e06884093bcefb86a6b8fd56a5d62a4cc245`; emsdk commit `bfce6709931a9381d91e6cd75c422dec2188fbf2` | Separate pthread module Workers; exact per-tool flags in artifact locks |
| W3 browser storage boundary | Chromium OPFS/WORKERFS gate passed at 64 MiB measured scale | N/A | Uses the unchanged W2 Emscripten 6.0.6 artifacts | Dedicated-Worker OPFS sync handles, legacy Emscripten FS device output; Firefox/Safari and multi-GiB inputs not tested |
| W4 hosted index catalog/cache | Local synthetic HISAT2 2.2.3 package passed; not product-enabled or production-hosted | N/A | JSON Schema plus versioned test manifest; exact hashes of eight `.ht2` files and GTF | Dedicated Worker, streaming fetch, incremental SHA-256, OPFS sync handles; same-origin Chromium only |
| W5 HISAT2 browser workflow | Experimental small-fixture gate passed; production W6 pending | N/A | Two-sample SE, raw `.fq.gz`, PE fragments, fastp ON/OFF, TPM/matrices, cancel/cleanup browser gate | Sequential dedicated Workers; W4 cache + W3 OPFS handoff; Chrome 151 only |
| CMake | 3.22.1 in archived build metadata | Not selected | `.wasm-build/CMakeFiles/3.22.1` | Unavailable on current host PATH |
| fastp | 0.23.4; W2 proof and W5 optional preprocessing passed (default OFF) | Native 0.23.4 validation CLI built on Ubuntu/WSL; no desktop bundle | Tag `v0.23.4`, commit `1ffcaed6892832c09c4b4094c201cd4eff8fa622`, canonical archive SHA-256 `43369abc...3c09` | Emscripten 6.0.6 + zlib 1.3.2; native g++ 11.4 + libisal 2.30.0-4 + libdeflate 1.10-2 |
| HISAT2 | 2.2.3; W2 proof and W5 experimental workflow passed | Native 2.2.3 validation CLI built on Ubuntu/WSL; no desktop bundle | Tag `v2.2.3`, commit `0d244324f98de541bce04d45c75e83bc3522f7f4`, canonical Git archive SHA-256 `20158b4e...e38` | Emscripten 6.0.6, wasm SIMD, pthreads, 256 MiB initial / 2 GiB max; native g++ 11.4 |
| featureCounts/Subread | 2.1.1; W2 proof and W5 experimental workflow passed | Official Windows x64 2.1.1 executable registered, SHA-256-verified, and `-v` tested; full D1 pipeline test pending fastp/HISAT2 | Official source archive SHA-256 `6392d7c66831cdd767e58251892a79a51b6fab8ed0ba9671ad5e85ff1ab01eaa`; binary inventory in `desktop/src-tauri/binaries/README.md` | Emscripten 6.0.6 + zlib 1.3.2, pthreads, 128 MiB initial / 2 GiB max; native gcc 11.4 |
| Tauri | Not applicable | 2.11.5 Rust crate; D1 Rust/Tauri command surface compiled on Windows x64, not release-ready | `desktop/src-tauri/Cargo.lock` | Tauri 2 with external-bin declarations; verified production sidecars are still absent |
| Rust | Not applicable | stable-x86_64-pc-windows-msvc locally used for D1 checks | `C:\\Users\\0314k\\.rustup\\toolchains\\stable-x86_64-pc-windows-msvc` | `cargo fmt --check`, `cargo test`, and desktop-feature check; version should be captured in release CI |

## Archived runtime hashes

- `kallisto/kallisto.js`: `2345D8EBBE7D085ACA542586FABDA3E8BEA105294CC2E19398A3A02B84A2B77F`
- `kallisto/kallisto.wasm`: `A0C5E90BD8ABC2C09E3126F2C7CCE1616E31EACDDDF5046FDF36CABB81AEE5AD`

The W2 proof artifact hashes and complete flags are locked in each tool's `artifacts.lock.json`. W4 adds the hosted-package/cache boundary. W5 enables only the explicitly experimental small-fixture pipeline; W6 production acceptance is still required.
