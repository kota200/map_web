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

- `desktop/src-tauri/binaries/fastp-x86_64-pc-windows-msvc.exe` is built from
  fastp commit `1ffcaed6892832c09c4b4094c201cd4eff8fa622` (version 0.23.4).
  It is MIT-licensed and statically links the exact MSYS2 packages recorded in
  `sidecars.x86_64-pc-windows-msvc.json`: GCC runtime libraries 16.2.0-3 under the GCC
  Runtime Library Exception, libwinpthread
  14.0.0.r283.ga7cb47123-1, ISA-L 2.31.1-1, and libdeflate 1.25-1. Their
  complete installed license files and SHA-256 values are bundled in
  `desktop/src-tauri/binaries/licenses` and registered in the manifest.
- `desktop/src-tauri/binaries/hisat2-x86_64-pc-windows-msvc.exe`,
  `hisat2-build-x86_64-pc-windows-msvc.exe`, and their four helpers are built
  from HISAT2 commit `0d244324f98de541bce04d45c75e83bc3522f7f4`
  (version 2.2.3) plus the checked-in script-free dispatcher. They are
  GPL-3.0-or-later and statically link the registered GCC runtime libraries.
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
- The corresponding fastp, HISAT2, and Subread source archives used by the
  Windows build, plus their checksum file, are committed under
  `desktop/corresponding-source/windows-x64`. The workflow and dispatcher source
  required to reproduce the modified package are also committed. Do not remove
  or separate these materials from a public binary release.
- Merged-main CI run `32437427175` (attempt 2) verified that no packaged executable imports an MSYS2
  runtime DLL. Windows operating-system libraries are not redistributed.

## D2 native Kallisto sidecars

- Native Kallisto remains pinned to version 0.52.0, commit
  `4e9f29cf3b021260415430c057a22469ca081391`, and BSD-2-Clause. Every binary
  package must reproduce the complete Kallisto license text in its bundled
  materials.
- The native build statically includes the Bifrost tree shipped by that Kallisto
  revision (BSD-2-Clause) and the bundled zlib-ng tree (zlib license). Each
  platform manifest records the component names, source URLs, complete local
  license paths, and license SHA-256 values.
- The Windows source transformation is derived from the pinned upstream file
  `.make_binaries.windows.txt`. The exact generated patch and unmodified source
  archive are uploaded with the Windows binary; build provenance points to the
  checked-in transformation script and workflow.
- The Windows manifest also registers the exact GCC runtime and libwinpthread
  package versions and license files used by the static MinGW build. Runtime
  verification hashes those license files before any linked sidecar starts.
- Linux and macOS builds archive the exact clean pinned source plus the generated
  CMake compatibility patch used for nested Bifrost/zlib-ng builds. Their binary
  and installer hashes are generated independently on the target runner; a hash
  from one architecture must never be reused for another.
- Kallisto's permissive license does not remove the separate GPL corresponding-
  source obligations for HISAT2 and featureCounts in the full Windows package.

## Release blockers

- D1 includes Windows x64 checksums, notices, build provenance, and corresponding
  source. A public installer/release still needs an explicit legal review and a
  release-process check that binary and source downloads remain available with
  equivalent access.
- The WebAssembly distribution obligations remain separate from this desktop
  package and still require their own production-hosting review.
- D2 CI may produce unsigned NSIS, DMG, DEB, and AppImage test artifacts. They
  are not public-release candidates until the relevant signing/notarization and
  legal release checks are completed.
- Do not claim legal compliance based only on this engineering inventory.
