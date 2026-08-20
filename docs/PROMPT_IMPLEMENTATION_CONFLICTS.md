# Prompt and Implementation Conflicts

No separate historical prompt was present in the supplied archive. The conflicts below compare the requested Web-first specification with the actual archived implementation; they are not claims about an unavailable document.

| Requested direction | Archived implementation | Resolution in this run |
|---|---|---|
| Product offers stable Kallisto, experimental HISAT2, and a later desktop path | Kallisto-only identity and navigation | W1 chooser added; unimplemented paths are visibly unavailable |
| Explicit scientific distinction between methods | No method comparison because only Kallisto existed | Added to chooser, Help, and architecture docs |
| Shared job/sample/result/event/cancel contracts | Kallisto-specific Worker messages only | Added versioned JSON Schemas; Kallisto adapter migration remains future work |
| Browser capability and storage preflight | Only Kallisto runtime/isolation status | Added measured capability/quota panel; HISAT2 enabled only after the small W5 gate |
| Hosted HISAT2 catalog and cache | None | W4 local synthetic catalog/cache passed; no fictional production URL or reference |
| fastp, HISAT2, featureCounts Wasm proofs | No sources, ports, binaries, or tests in the supplied archive | W2 individual proofs completed with pinned sources, isolated patches, native baselines, reproducible artifacts, and real Chromium tests |
| Desktop only after Web acceptance | No Tauri code | Preserved; no desktop scaffold created |
| Automated scientific regression baseline | Static matrix/lifecycle source tests only | Added golden outputs and real browser/Wasm regression harness |
| Exact pinned toolchain | Build flags and CMake 3.22.1 artifacts, but no exact Emscripten version | Recorded as a reproducibility risk; packaged binary treated as baseline |
| Original sources and Wasm remain preserved | Patched dirty source and binaries were included | Archive untouched; vendor/runtime algorithm files not edited in W1 |
