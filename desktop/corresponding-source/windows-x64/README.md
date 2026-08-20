# Windows x64 corresponding source

These archives accompany the Windows D1 sidecar binaries committed under
`desktop/src-tauri/binaries`.

| Archive | SHA-256 |
|---|---|
| `fastp-v0.23.4-source.tar.gz` | `65b359aac21a688fb4f72b29677960ddb759c8749e37f0503e6695d6bb46cf06` |
| `hisat2-v2.2.3-source.tar.gz` | `68a492ac2896aeb49685d7b93b2e954152810ec2ccb095777a5f9e19fff07627` |
| `subread-source.tar.gz` | `6392d7c66831cdd767e58251892a79a51b6fab8ed0ba9671ad5e85ff1ab01eaa` |

The fastp and HISAT2 archives are generated from the exact commits in
`.github/workflows/windows-sidecars.yml`. The Subread archive is the official
2.1.1 source download. `CORRESPONDING_SOURCE_SHA256SUMS` is the CI-generated
checksum evidence.

The checked-in workflow and `desktop/sidecar-dispatcher` source are part of the
reproducible source for this Windows package. Keep them, these archives, the
binary manifest, and all license files together for public distribution.
This is an engineering distribution control and not legal advice.
