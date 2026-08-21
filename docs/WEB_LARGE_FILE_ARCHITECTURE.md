# Web Large-file Architecture

Status: Phase W3 architecture gate passed on 2026-08-17 for the measured 64 MiB synthetic fixture and tiny real-engine handoff. This is not a human-genome-size support claim.

## Selected boundary

```text
user File/Blob ---------------------------> tool Worker WORKERFS (read-only)
hosted index Response.body -> storage Worker -> OPFS committed entry
                                            -> HISAT2 Worker WORKERFS
fastp POSIX output -> bounded FS device write -> OPFS committed cleaned FASTQ
HISAT2 -S output -> bounded FS device write -> OPFS committed SAM
                                            -> featureCounts Worker WORKERFS
Workers exchange { schemaVersion, entryId }, not file bytes
```

OPFS synchronous access handles are opened only in dedicated Workers. Each entry contains `payload.data`; `state.json` is written last, after flush/close and exact size validation. Consumers reject entries without a valid ready marker or whose persisted size differs. Recovery removes incomplete/invalid entries and retains ready entries. This follows the platform constraint that synchronous OPFS access is Worker-only and exclusively locks a writable file handle: [MDN OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system), [MDN createSyncAccessHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle).

The current W2 Emscripten artifacts explicitly include WORKERFS and the legacy JavaScript FS. Emscripten documents WORKERFS as read-only `File`/`Blob` access without copying the complete file into memory; IDBFS must be linked explicitly and synchronizes a memory filesystem to IndexedDB. See the [Emscripten File System API](https://emscripten.org/docs/api_reference/Filesystem-API.html).

## Candidate decision

| Candidate | Decision | Evidence / reason |
|---|---|---|
| WORKERFS | Selected for user FASTQ, OPFS snapshots, index, SAM, and annotation input | Actual fastp, HISAT2, and featureCounts Workers read `File` objects; the complete artifact is not materialized in application JS. Read-only is appropriate. |
| OPFS sync access handle | Selected for persistent cache and temporary large outputs | Actual 64 MiB persistence/reload test passed. Separate Workers reopened committed files by descriptor. |
| Custom Emscripten character device | Selected for fastp cleaned FASTQ and HISAT2 SAM output | Actual POSIX writes went from bounded Wasm heap views directly to an OPFS sync handle. No full output was returned through `postMessage`. |
| MEMFS | Rejected for cleaned FASTQ, index cache, and SAM | It retains the full artifact in Wasm linear memory and disappears on Worker termination/reload. Small reports/count tables may still use it. |
| IDBFS | Rejected for large artifacts in this build | It is not linked/exported by the pinned modules, and its `syncfs()` memory-to-IndexedDB model would retain a complete MEMFS representation. |
| WasmFS | Not selected | Emscripten documents it as stable but not feature-complete; the pinned artifacts were built around legacy FS/WORKERFS and do not export WasmFS. Rebuilding all engines solely for W3 would add a second unvalidated storage stack. |
| Whole-file transferable `ArrayBuffer` | Rejected | Transfer avoids one structured-clone copy but still requires a full-size JS-owned buffer and detaches ownership from the producer. It does not provide persistent multi-consumer sharing. |
| Bounded transferable chunks | Reserved alternative | It can keep transfer size bounded, but featureCounts requires seekable file semantics. OPFS supplies those semantics with a single persisted SAM. |
| PROXYFS | Rejected across independent engine Workers | It shares Emscripten module filesystems, not a crash/reload-persistent origin store, and couples module lifetimes. |

## Measured Chromium run

Harness: `tools/w3-storage/tests/browser-gate.html`; cross-origin isolated Chrome 151.0.0.0 in the Codex in-app browser on Windows x64; 16 logical processors reported; Emscripten 6.0.6 W2 artifacts.

| Measurement | Observed result |
|---|---:|
| Synthetic artifact | 67,108,864 bytes (64 MiB), generated inside storage Worker |
| OPFS write | 474.55 ms; 134.87 MiB/s; 1 MiB maximum persisted write |
| Main-thread response during write | 32 heartbeats; 17.18 ms maximum gap; zero reported long tasks |
| Main JS heap during write | 4,567,161 to 4,581,445 bytes; observation only |
| Cross-Worker OPFS read | 232.77 ms; 274.95 MiB/s; 2 MiB maximum stream chunk |
| Main-thread response during read | 14 heartbeats; 16.91 ms maximum gap; zero reported long tasks |
| Main JS heap during read | 7,005,141 to 7,014,029 bytes; observation only |
| Streaming integrity | write/read FNV-1a both `f11c9dc5` |
| Storage estimate | quota 10,737,418,576; usage 336; available 10,737,418,240 bytes |
| Quota failure | request for available+1 byte rejected before allocation |
| Same-origin hosted index part | 4,194,805 bytes; source chunk max 2 MiB; persisted in five writes, max 1 MiB |

Throughput and heap values are single-run observations, not support thresholds. The application never received the 64 MiB payload on the main thread.

## Actual engine boundary

The gate also ran the unmodified W2 scientific fixtures through the selected storage path:

- fastp read the user-style `File` through WORKERFS and wrote a 70-byte cleaned gzip to OPFS in two device writes; only its small JSON/HTML reports returned to the caller.
- Eight tiny index parts were fetched and committed by the storage Worker, reopened inside a separate HISAT2 Worker, and mounted through WORKERFS.
- HISAT2 wrote a 556-byte SAM directly to OPFS with `-S /output/se.sam`; the result message contained no SAM bytes.
- A new featureCounts Worker reopened that OPFS SAM through WORKERFS and returned native-equivalent `g1`, Length 160, raw count 2.

Full-size application-level copy count for the SAM handoff: zero main-thread copies, zero Worker-to-Worker byte transfers, one persisted OPFS artifact. Browser/Wasm internals still perform bounded copies at file-read and OPFS-write boundaries; the claim is not zero-copy at the hardware level.

## Cancel, failure, and reload

- The page wrote a valid 64 MiB entry and an intentional 1 MiB entry without a ready marker, then reloaded.
- A fresh Worker retained the valid entry and removed the incomplete entry.
- During a planned 256 MiB write, the storage Worker was terminated after progress. The pending operation rejected with `AbortError`; a fresh Worker detected and removed the partial entry.
- Final cleanup removed the benchmark, cleaned FASTQ, SAM, downloaded index parts, and metadata. No `w3-gate-*` entry remained.
- A ready marker is never written on nonzero tool exit. Unexpected Worker termination can leave bytes, but not a consumable ready entry.

## Gate conclusion and limits

W3 passes for the architecture choice: main-thread responsiveness, bounded persistence, separate-Worker sharing, quota preflight, reload integrity, cancellation recovery, and actual fastp/HISAT2/featureCounts file boundaries are demonstrated.

Still not tested:

- GRCh38/GRCm39 or another multi-GiB production index.
- Multi-GiB FASTQ, cleaned FASTQ, or SAM peak memory and runtime.
- Firefox representative/64 MiB storage behavior, real Safari behavior, storage eviction, private-browsing quotas, low-disk operating-system failures, or multi-tab write contention. Firefox 141 has passed only the later W6 small-fixture gates.
- Cross-origin CDN headers and retry/range-download behavior.
- Cryptographic per-file verification and multi-file atomic catalog transactions; these are Phase W4.

W4 catalog integrity and the small W5 end-to-end gate now pass, so the product card is enabled as Experimental. Production-scale references, multi-GiB inputs, cross-origin CDN behavior, storage eviction, and broader browser support remain W6 gates.
