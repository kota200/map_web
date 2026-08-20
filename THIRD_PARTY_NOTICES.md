# Third-party Notices and License Audit

This file is an engineering inventory, not legal advice. Preserve the complete license texts from upstream sources in every source and binary distribution.

## Bundled in the supplied archive

### kallisto 0.52.0

- Source: `https://github.com/pachterlab/kallisto`
- License: BSD 2-Clause.
- Local text: `KALLISTO_LICENSE.txt` and `vendor/kallisto/license.txt`.
- The WebAssembly port modifies upstream source. Source redistributions must retain the copyright, conditions, and disclaimer; binary distributions must reproduce them in documentation/materials.

### Bifrost

- Bundled under `vendor/kallisto/ext/bifrost`.
- License: BSD 2-Clause.
- Local text: `vendor/kallisto/ext/bifrost/LICENSE`.

### zlib-ng

- Bundled under `vendor/kallisto/ext/zlib-ng` and linked into the Wasm runtime.
- Version marker: `2.1.0.devel`.
- License: zlib-style license.
- Local text: `vendor/kallisto/ext/zlib-ng/LICENSE.md`.

The license requires altered source versions to be plainly marked and the notice to remain in source distributions.

### HTSlib source tree

- Bundled under `vendor/kallisto/ext/htslib`; the archived Web build disables BAM support.
- License: MIT/Expat for files outside `cram/`; modified BSD for `cram/`, with additional component notices in the complete local text.
- Local text: `vendor/kallisto/ext/htslib/LICENSE`.

Do not assume disabled code can be omitted from source-archive notices without checking the actual distribution contents.

## Phase W2 proof artifacts

### fastp 0.23.4

- Source: `https://github.com/OpenGene/fastp/tree/v0.23.4`.
- Pin: commit `1ffcaed6892832c09c4b4094c201cd4eff8fa622` and canonical Git archive SHA-256 `43369abc2dab82829105a0d797e062487395be7a745a5c387a92c60b79cc3c09`.
- License: MIT; local text `tools/fastp/licenses/fastp-MIT.txt`.
- The distributed W2 Wasm artifact is modified only at the gzip adapter boundary. The patch generator and build instructions are shipped under `tools/fastp/`.

### zlib 1.3.2

- Source: `https://github.com/madler/zlib/tree/v1.3.2` through Emscripten's pinned `USE_ZLIB` port.
- Source archive SHA-512 is recorded in the fastp and featureCounts source locks.
- License: zlib license; local text `tools/fastp/licenses/zlib-1.3.2.txt`.
- The Wasm build links zlib for gzip input/output. The adaptation is plainly marked and does not claim to be upstream fastp's native compression backend.

### Emscripten 6.0.6 generated runtime

- Compiler pin: `ce75e06884093bcefb86a6b8fd56a5d62a4cc245`.
- License: dual MIT and University of Illinois/NCSA, with bundled runtime component notices; local copies are kept under each W2 tool's `licenses/` directory.

### Native baseline-only dependencies

- ISA-L/libisal `2.30.0-4`: BSD-3-Clause.
- libdeflate `1.10-2`: MIT/Expat.
- Exact Ubuntu package hashes and notices are recorded in `tools/fastp/source.lock.json` and `tools/fastp/licenses/native-baseline-dependencies.txt`.
- These libraries and the native validation binary are in `.w2-cache`, not Web distribution artifacts. A future desktop bundle must carry complete platform-specific notices.

### HISAT2 2.2.3

- Source: `https://github.com/DaehwanKimLab/hisat2/tree/v2.2.3`
- Pin: commit `0d244324f98de541bce04d45c75e83bc3522f7f4` and canonical Git archive SHA-256 `20158b4edfb7f2a2324d0d7f252e9833b2af9b66ec620a59e84adb336f9d4e38`.
- License: GPL-3.0-or-later; local text `tools/hisat2/licenses/HISAT2-GPL-3.0.txt`.
- The distributed W2 proof carries an isolated wasm32 signed-coordinate fix plus a deterministic Emscripten build target. Patch generator, complete build flags, and source retrieval instructions are under `tools/hisat2/`.
- Distribution of this modified Wasm work requires GPL corresponding source and notices; a production hosting/release procedure still needs explicit legal review.

### Subread/featureCounts 2.1.1

- Source: `https://sourceforge.net/projects/subread/files/subread-2.1.1/`
- Pin: official source archive SHA-256 `6392d7c66831cdd767e58251892a79a51b6fab8ed0ba9671ad5e85ff1ab01eaa`.
- License: GPL-3.0-or-later; local text `tools/featurecounts/licenses/Subread-GPL-3.0.txt`.
- The distributed W2 proof patch is limited to Emscripten stdio compatibility, browser-inapplicable file-limit probes, captured log formatting, and module naming. Patch generator, source retrieval, and complete build flags are under `tools/featurecounts/`.
- The Wasm binary links Emscripten's pinned zlib 1.3.2 port; local zlib and Emscripten notices are in `tools/featurecounts/licenses/`.
- Distribution of this modified Wasm work requires GPL corresponding source and notices; a production hosting/release procedure still needs explicit legal review.

## Windows desktop sidecars

- `desktop/src-tauri/binaries/featureCounts-x86_64-pc-windows-msvc.exe` is the
  unmodified `featureCounts` executable from the official
  `subread-2.1.1-Windows-x86_64.zip` package. Its SHA-256 is
  `30cf41c2bac4707754b4d7faab96743a16957bdb21ecee82e64fd941905185d9`.
- The bundled copy is GPL-3.0-or-later. Its full license text is at
  `desktop/src-tauri/binaries/licenses/Subread-GPL-3.0.txt`; its matching
  source URL and archive checksum are in `tools/featurecounts/source.lock.json`.
- Each public desktop release must provide the corresponding source artifact at
  no additional charge and link to it alongside the binary download. Keeping a
  license text in the installer alone is not sufficient.

## Release blockers

- Decide and document how modified HISAT2/Subread corresponding source, build scripts, license texts, and notices will be offered alongside production Web artifacts and future desktop binaries.
- Generate platform-specific binary checksums and include notices in installers before any desktop release. D1's sidecar manifest now has fields for source URL, license identifier, and bundled license path, but contains no records until verified Windows x64 executables exist.
- Do not claim license compliance based only on this preliminary inventory.
