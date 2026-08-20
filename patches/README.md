# Local kallisto WebAssembly patch

`kallisto-web-wasm.patch` is applied to the `vendor/kallisto` submodule at
commit `4e9f29cf3b021260415430c057a22469ca081391`.  It contains the changes
used to build the checked-in WebAssembly artifacts: Emscripten build settings,
safe repeated `callMain` invocation, FASTQ validation and browser performance
instrumentation.

To reproduce a WebAssembly build after initializing the submodule:

```sh
git -C vendor/kallisto apply ../patches/kallisto-web-wasm.patch
```

Do not apply this patch to a different kallisto revision without reviewing it.
