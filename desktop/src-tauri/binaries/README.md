# Windows x64 sidecar inventory

Only files recorded in `sidecars.windows-x86_64.json` may execute. Rust checks
the SHA-256 of every executable, HISAT2 helper, and tool license before launch.
The Tauri build accepts only the target-suffixed main executables declared in
`tauri.conf.json`; the verified HISAT2 dispatchers select the registered small
or large index helpers without Python, Perl, PATH, WSL, or a shell.

## Registered binaries

| Tool | Version | SHA-256 | Origin |
|---|---:|---|---|
| fastp | 0.23.4 | `a8c554a291b40f52f88a36529fb23cbe6cfcdd7762625372d681db30ff8c9253` | Commit `1ffcaed6892832c09c4b4094c201cd4eff8fa622`, built by the checked-in workflow |
| HISAT2 | 2.2.3 | `b9254614a97fe5ab4f730a9d884f7a1e6f42027c4561ff0fc0f004815da1d895` | Commit `0d244324f98de541bce04d45c75e83bc3522f7f4`, built by the checked-in workflow |
| hisat2-build | 2.2.3 | `55707cc9f009f34089f0333bbd3bcf8f18b980f82eca3865f15c2c3681ff5323` | Same pinned HISAT2 source plus the checked-in script-free dispatcher |
| featureCounts | 2.1.1 | `30cf41c2bac4707754b4d7faab96743a16957bdb21ecee82e64fd941905185d9` | Unmodified official Subread Windows x64 package |

fastp, the HISAT2 helpers, and the dispatchers are statically linked. CI fails
if any packaged executable imports a `/ucrt64/bin` DLL. The manifest records
the exact MSYS2 package versions, origins, license expressions, bundled license
files, and license-file hashes for GCC runtime libraries, libwinpthread, ISA-L,
and libdeflate. There are no bundled MSYS2 DLL files.

## Verification evidence

GitHub Actions run
[`32385204268`](https://github.com/kota200/map_web/actions/runs/32385204268)
completed on 2026-08-21 (JST). It built from fixed source revisions, rejected
dynamic MSYS2 linkage, checked all four version commands and exit codes, copied
the artifact into the Tauri binary directory, launched all four main sidecars
from the compiled Tauri application, ran the Rust test suite, and completed a
`desktop` feature build.

Matching source archives and checksums are committed under
`desktop/corresponding-source/windows-x64`. HISAT2 and Subread are
GPL-3.0-or-later. Keep those source archives, the repository build workflow and
dispatcher source, notices, and license files available alongside every public
binary release. This inventory is engineering evidence, not legal advice;
obtain legal review before a public installer or binary release.
