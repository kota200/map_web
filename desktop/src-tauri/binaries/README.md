# Windows x64 sidecar inventory

Only files recorded in `sidecars.windows-x86_64.json` may execute. Rust checks
the SHA-256 of the executable and each registered support file before launch.
The Tauri build copies only target-suffixed executable files declared by
`tauri.conf.json`; helper files are packaged alongside the app and are checked
by the verified dispatcher before use.

## Registered now

| Tool | Version | SHA-256 | Origin | Runtime evidence |
|---|---:|---|---|---|
| featureCounts | 2.1.1 | `30cf41c2bac4707754b4d7faab96743a16957bdb21ecee82e64fd941905185d9` | Official Subread Windows x64 binary package | `featureCounts.exe -v` exited 0; the retained SE SAM/GTF fixture produced `g1`, Length `160`, Count `2`, and Assigned `2`, 2026-08-20 |

The package's GPL-3.0 license is copied to `licenses/Subread-GPL-3.0.txt`.
The matching source URL and source archive checksum are recorded in
`tools/featurecounts/source.lock.json`; a release must publish corresponding
source with equivalent access to the binary.

## Not registered

The locally supplied `hisat2-2.2.1` files are macOS binaries and version 2.2.1.
They are not compatible with the Windows x64 / HISAT2 2.2.3 D1 contract and are
not copied or executed. fastp 0.23.4 and HISAT2 2.2.3 are produced by
`.github/workflows/windows-sidecars.yml` from the source-lock commits. That
workflow emits both a sidecar package and a corresponding-source artifact;
review its hashes and runtime test logs before replacing this manifest.
