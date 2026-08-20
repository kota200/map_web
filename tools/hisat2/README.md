# HISAT2 2.2.3 W2 proof

This directory is an individual, non-product-integrated WebAssembly proof for
HISAT2 2.2.3. The native `hisat2-build-s` creates the fixed eight-part index;
the browser proof only runs `hisat2-align-s` against an existing index.

The isolated port contains one wasm32 correctness fix: cast `refExtent()` to
the signed `TRefOff` before subtracting it from `1`. Without that cast,
wasm32 `size_t` underflow changes paired-end TLEN from `±120` to `±40` in the
fixture. No alignment or scoring algorithm is replaced.

Run from WSL Ubuntu:

```bash
tools/hisat2/run-native-baseline.sh
tools/hisat2/build-wasm.sh
```

Then run with the bundled Node.js runtime:

```text
node tools/hisat2/tests/run-node-wasm.mjs
node tools/hisat2/tests/compare-results.mjs
node tools/hisat2/tests/cancel-worker.mjs
node tools/hisat2/tests/static-runtime.mjs
```

The module uses pthreads, wasm SIMD, a 256 MiB initial memory, a 2 GiB maximum,
and a dedicated outer module Worker. Cancellation terminates that Worker. W2
only proves the tiny fixture; large indexes and real memory peaks remain W3.
