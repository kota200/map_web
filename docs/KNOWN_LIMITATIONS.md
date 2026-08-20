# Known Limitations

- Kallisto is the stable recommended workflow. HISAT2 + featureCounts is enabled only as an Experimental W5 workflow while W6 remains open.
- W5 is product-integrated for a synthetic tiny reference and fixtures only. It is not production-scale biological validation.
- Desktop/Tauri code, native sidecars, installers, signing, and notarization are absent.
- Kallisto uses a 3 GiB Wasm linear-memory ceiling. Browser and operating-system limits can be lower.
- Generated Kallisto indexes and output artifacts are memory-backed. Large index construction can fail.
- The browser preflight reads only a prefix of uncompressed or stream-decompressed FASTQ. Kallisto remains the parser of record.
- The exact Emscripten version used for the archived runtime was not recorded and cannot be reproduced from this archive alone.
- A fresh native kallisto 0.52.0 scientific comparison was not possible in this environment.
- The existing large benchmark report contains one run per thread count and an incompletely identified Arabidopsis reference; it is performance evidence, not a portable support threshold.
- No production HISAT2 index/annotation URL is configured. W4 validates the local synthetic catalog and cache transaction; it does not establish production CDN headers, provenance, licenses, assembly selection, or availability.
- W6 measured one 3.10 GB paired gzip Kallisto run and a 135.2 MB generated index in Chrome 151 with tracked Wasm memory. The fresh index run reached 1,120,010,240 bytes; quantification showed a rounded 747.8 MiB high water. `browser_performance.json` now records the final/high-water Wasm byteLength, but this is Wasm allocation rather than browser-process or OS resident memory. This single successful run is not a portable minimum-support threshold.
- Representative HISAT2 index/FASTQ/SAM peak memory, production CDN behavior, cross-origin download, storage eviction, and biological agreement remain unmeasured. Only the 4,203,807-byte synthetic package has passed end to end.
- W5 cleanup removes temporary decompressed FASTQ and SAM; optional fastp cleaned FASTQ remains in OPFS until explicitly deleted, replaced by a new run, or best-effort page cleanup succeeds. Kallisto fastp uses the same explicit retained-output/delete boundary; its index and standard quant outputs remain memory-backed.
- The W2–W6 paths were run only in the current Chromium-based in-app browser and Node 24.19.0 where applicable. Firefox was not installed in the Windows validation environment; Safari requires a separate macOS environment. Both remain unmeasured.
- No analytics or telemetry is included.
