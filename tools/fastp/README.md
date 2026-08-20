# fastp 0.23.4 WebAssembly proof of concept

Status: Phase W2 fastp acceptance passed for the tiny SE/PE fixtures. This is
an isolated engine harness, not an enabled product preprocessing option.
Kallisto continues to run with fastp OFF by default.

## Provenance and adaptation boundary

- Upstream fastp: tag `v0.23.4`, full commit
  `1ffcaed6892832c09c4b4094c201cd4eff8fa622`.
- Canonical `git archive` SHA-256:
  `43369abc2dab82829105a0d797e062487395be7a745a5c387a92c60b79cc3c09`.
- Emscripten: `6.0.6` / commit
  `ce75e06884093bcefb86a6b8fd56a5d62a4cc245`.
- Emscripten zlib port: zlib `1.3.2` with the SHA-512 in
  `source.lock.json`.
- Exact binary hashes and flags: `artifacts.lock.json`.

The upstream filtering, trimming, QC, reporting, and threading source is not
changed. `patches/apply-wasm-port.py` replaces only ISA-L gzip input and
libdeflate gzip output with zlib streaming calls. This is necessary because
the upstream ISA-L path is x86 assembly-oriented. Gzip container bytes can
differ; tests compare decompressed FASTQ records and order.

## Build and native baseline

Run in Ubuntu/WSL from the application root:

```text
bash tools/fastp/fetch-source.sh
bash tools/fastp/build-native.sh
bash tools/fastp/run-native-baseline.sh
FASTP_EMSDK_DIR=/absolute/path/to/emsdk bash tools/fastp/build-wasm.sh
```

`prepare-native-deps.sh` downloads exact Ubuntu `.deb` files and verifies
their SHA-256 before extracting them under `.w2-cache`; it does not install
system packages. The Wasm script rejects any Emscripten version other than
6.0.6. Two consecutive builds produced identical JS and Wasm SHA-256 values.

## Tests

With Emscripten's Node 24.19.0:

```text
node tools/fastp/test/run-node-wasm.mjs
node tools/fastp/test/static-runtime.mjs
node tools/fastp/test/compare-results.mjs
node tools/fastp/test/cancel-worker.mjs
```

Serve the application with isolation headers and open:

```text
python build/serve.py
http://127.0.0.1:8000/tools/fastp/test/browser-integration.html
```

The browser test uses module Workers, pthreads, SharedArrayBuffer, and
WORKERFS-mounted `File` objects. It validates SE, PE, nonzero malformed-FASTQ
exit propagation, stdout/stderr capture, and cancellation after the Worker
enters the running state.

## Current limits

- W2 outputs are in Worker-local MEMFS and are intentionally tiny. Large
  cleaned FASTQ persistence belongs to the Phase W3 file-backed I/O gate.
- The wrapper exposes only the typed options needed for the proof fixture; it
  is not the final product parameter surface.
- The fixture explicitly disables duplication evaluation, poly-G trimming,
  and (for PE) adapter trimming so that the tested command is deterministic
  and bounded. Exact argument arrays are returned and displayed.
- Initial shared Wasm memory is 256 MiB, with a 2 GiB maximum and growth
  enabled. Actual large-data memory behavior is not measured.
- Chromium passed. Firefox and Safari are not tested.
