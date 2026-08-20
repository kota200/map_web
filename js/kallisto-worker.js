function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

const RUNTIME_CACHE_VERSION = '20260820-w6';
const KALLISTO_WASM_MAXIMUM_MEMORY_BYTES = 3 * 1024 * 1024 * 1024;

function versionedUrl(path, base) {
  const url = new URL(path, base);
  url.searchParams.set('v', RUNTIME_CACHE_VERSION);
  return url.href;
}

function memoryBytes(memory) {
  const bytes = Number(memory?.buffer?.byteLength);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

async function prepareTrackedInstantiation(moduleBase) {
  const wasmUrl = versionedUrl('kallisto.wasm', moduleBase);
  const response = await fetch(wasmUrl, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`kallisto.wasm returned HTTP ${response.status}.`);
  let wasmModule;
  try {
    wasmModule = await WebAssembly.compileStreaming(response);
  } catch (_) {
    const fallbackResponse = await fetch(wasmUrl, { credentials: 'same-origin' });
    if (!fallbackResponse.ok) throw new Error(`kallisto.wasm returned HTTP ${fallbackResponse.status}.`);
    wasmModule = await WebAssembly.compile(await fallbackResponse.arrayBuffer());
  }
  const tracker = { memory: null, initialBytes: null };
  return {
    tracker,
    instantiateWasm(imports, receiveInstance) {
      const memory = imports?.env?.memory || imports?.wasi_snapshot_preview1?.memory;
      if (!(memory instanceof WebAssembly.Memory)) throw new Error('Kallisto Wasm imports did not expose linear memory.');
      tracker.memory = memory;
      tracker.initialBytes = memoryBytes(memory);
      const instance = new WebAssembly.Instance(wasmModule, imports);
      receiveInstance(instance, wasmModule);
      return instance.exports;
    },
  };
}

function ensureDir(FS, path) {
  try {
    FS.mkdir(path);
  } catch (error) {
    if (!String(error).includes('File exists')) throw error;
  }
}

function sanitizeName(name, fallback) {
  const cleaned = String(name || fallback)
    .replace(/[\\/]/g, '_')
    .replace(/[^A-Za-z0-9._+\-]/g, '_');
  return cleaned || fallback;
}

function roundSec(milliseconds) {
  if (!Number.isFinite(milliseconds)) return null;
  return Number((milliseconds / 1000).toFixed(3));
}

function durationSec(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return roundSec(end - start);
}

function parseRequestedThreads(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i]);
    if ((arg === '-t' || arg === '--threads') && i + 1 < args.length) {
      const n = Number(args[i + 1]);
      if (Number.isFinite(n)) return n;
    }
    const match = arg.match(/^--threads=(\d+)$/);
    if (match) return Number(match[1]);
  }
  return 1;
}

function parseRunInfo(outputs) {
  const file = outputs.find((item) => item.name === 'run_info.json');
  if (!file) return null;
  try {
    return JSON.parse(new TextDecoder().decode(file.buffer));
  } catch (_) {
    return null;
  }
}

function markWebPerf(text, timing, onStage = () => {}) {
  const line = String(text);
  const stageMatch = line.match(/\[WEBPERF\]\s+(index_load_begin|index_load_end|index_graph_loaded|index_dlist_loaded|index_nodes_loaded|pseudoalign_begin|pseudoalign_end|em_begin|em_end|output_begin|output_end)/);
  if (stageMatch && !Number.isFinite(timing[stageMatch[1]])) {
    timing[stageMatch[1]] = performance.now();
    const statuses = {
      index_load_begin: 'Loading index',
      pseudoalign_begin: 'Quantifying',
      em_begin: 'Running EM',
      output_begin: 'Generating output',
    };
    if (statuses[stageMatch[1]]) onStage(statuses[stageMatch[1]]);
  }
  const bufferMatch = line.match(/\[WEBPERF\]\s+read_batch_bytes=(\d+)\s+gzip_buffer_bytes=(\d+)/);
  if (bufferMatch) {
    timing.read_batch_bytes = Number(bufferMatch[1]);
    timing.gzip_buffer_bytes = Number(bufferMatch[2]);
  }
  if (/\[~warn\]\s+could not set 1 MiB gzip input buffer/.test(line)) {
    timing.gzip_buffer_bytes = null;
  }
  const workerMatch = line.match(/\[WEBPERF\]\s+worker_stats\s+id=(-?\d+)\s+batches=(\d+)\s+reads=(\d+)\s+reader_wait_us=(\d+)\s+fetch_us=(\d+)\s+process_us=(\d+)\s+update_us=(\d+)\s+total_us=(\d+)/);
  if (workerMatch) {
    timing.worker_stats ||= [];
    timing.worker_stats.push({
      id: Number(workerMatch[1]),
      batches: Number(workerMatch[2]),
      reads: Number(workerMatch[3]),
      reader_wait_sec: Number((Number(workerMatch[4]) / 1e6).toFixed(3)),
      fetch_sec: Number((Number(workerMatch[5]) / 1e6).toFixed(3)),
      pseudoalignment_sec: Number((Number(workerMatch[6]) / 1e6).toFixed(3)),
      result_merge_sec: Number((Number(workerMatch[7]) / 1e6).toFixed(3)),
      total_sec: Number((Number(workerMatch[8]) / 1e6).toFixed(3)),
    });
  }
  const concurrencyMatch = line.match(/\[WEBPERF\]\s+active_read_workers=(\d+)\s+paired_parallel_gzip=(0|1)/);
  if (concurrencyMatch) {
    timing.active_read_workers = Number(concurrencyMatch[1]);
    timing.paired_parallel_gzip = concurrencyMatch[2] === '1';
  }
}

function makePerformanceOutput(timing, args, outputs, metadata = {}) {
  const runInfo = parseRunInfo(outputs);
  const pseudoalignSec = durationSec(timing.pseudoalign_begin, timing.pseudoalign_end);
  const totalSec = durationSec(timing.request_start, timing.request_end);
  const kallistoCallSec = durationSec(timing.call_begin, timing.call_end);
  const nProcessed = Number(runInfo?.n_processed);

  const performanceReport = {
    schema_version: 2,
    app_version: 'v10.4-batch',
    operation: metadata.operation || 'quant',
    sample: metadata.sample || null,
    timing_clock: 'Web Worker performance.now()',
    timing_notes: 'Serial index deserialization is retained for stability; requested threads remain active for pseudoalignment. Batch samples reuse one Wasm module but reload the index in each kallisto CLI call. The first sample total includes module initialization and the shared index mount; later totals begin with that sample mount. Times use Web Worker performance.now().',
    threads: parseRequestedThreads(args),
    browser_threads: Number(self.navigator?.hardwareConcurrency || 0) || null,
    wasm_initialization_sec: durationSec(timing.runtime_begin, timing.runtime_ready),
    input_mount_sec: durationSec(timing.mount_begin, timing.mount_end),
    index_loading_sec: durationSec(timing.index_load_begin, timing.index_load_end),
    index_graph_load_sec: durationSec(timing.index_load_begin, timing.index_graph_loaded),
    index_post_graph_metadata_sec: durationSec(timing.index_graph_loaded, timing.index_load_end),
    fastq_processing_pseudoalignment_sec: pseudoalignSec,
    em_sec: durationSec(timing.em_begin, timing.em_end),
    output_generation_sec: durationSec(timing.output_begin, timing.output_end),
    kallisto_call_sec: kallistoCallSec,
    output_collection_sec: durationSec(timing.output_collection_begin, timing.output_collection_end),
    total_sec: totalSec,
    n_processed: Number.isFinite(nProcessed) ? nProcessed : null,
    reads_per_sec: Number.isFinite(nProcessed) && pseudoalignSec > 0
      ? Number((nProcessed / pseudoalignSec).toFixed(1))
      : null,
    total_reads_per_sec: Number.isFinite(nProcessed) && totalSec > 0
      ? Number((nProcessed / totalSec).toFixed(1))
      : null,
    read_batch_bytes: Number.isFinite(timing.read_batch_bytes) ? timing.read_batch_bytes : null,
    gzip_buffer_bytes: Number.isFinite(timing.gzip_buffer_bytes) ? timing.gzip_buffer_bytes : null,
    active_read_workers: Number.isFinite(timing.active_read_workers) ? timing.active_read_workers : null,
    paired_parallel_gzip: timing.paired_parallel_gzip === true,
    worker_stats: Array.isArray(timing.worker_stats)
      ? timing.worker_stats.sort((a, b) => a.id - b.id)
      : [],
    wasm_initial_linear_memory_bytes: Number.isFinite(metadata.wasmInitialLinearMemoryBytes)
      ? metadata.wasmInitialLinearMemoryBytes
      : null,
    wasm_linear_memory_bytes: Number.isFinite(metadata.wasmLinearMemoryBytes)
      ? metadata.wasmLinearMemoryBytes
      : null,
    wasm_peak_linear_memory_bytes: Number.isFinite(metadata.wasmLinearMemoryBytes)
      ? metadata.wasmLinearMemoryBytes
      : null,
    wasm_maximum_linear_memory_bytes: KALLISTO_WASM_MAXIMUM_MEMORY_BYTES,
    wasm_memory_measurement_note: 'WebAssembly.Memory grows monotonically and does not shrink; final linear-memory byteLength is the per-Worker high-water allocation, not operating-system resident memory.',
    optimization: {
      o3: true,
      lto: 'selective',
      wasm_simd128: 'selective',
      compression: 'zlib-ng (zlib-compatible API)',
      optimization_scope: 'SIMD/LTO on quant hot path + zlib-ng; conservative O3 on Bifrost/KmerIndex serialization',
      index_load_threads: 1,
      memory64: true,
      pthread_pool_size: 9,
    },
  };

  const bytes = new TextEncoder().encode(`${JSON.stringify(performanceReport, null, 2)}\n`);
  return {
    path: '/virtual/browser_performance.json',
    name: 'browser_performance.json',
    buffer: bytes.buffer,
  };
}

async function runKallisto(payload) {
  const timing = { request_start: performance.now() };
  post('status', { message: 'Loading kallisto WebAssembly runtime...' });

  const wrapperUrl = self.location.href;
  const kallistoScriptUrl = versionedUrl('../kallisto/kallisto.js', wrapperUrl);
  const moduleBase = new URL('../kallisto/', wrapperUrl);

  if (!self.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error('WebAssembly threads are unavailable. Serve this app with COOP/COEP headers (Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp).');
  }

  timing.runtime_begin = performance.now();
  try {
    importScripts(kallistoScriptUrl);
  } catch (error) {
    throw new Error(
      'kallisto WebAssembly runtime was not found. Build it with build/build-wasm.sh and place kallisto.js + kallisto.wasm in the kallisto/ directory. ' +
      `Original error: ${error}`
    );
  }

  const createKallisto = self.createKallisto;
  if (typeof createKallisto !== 'function') {
    throw new Error('kallisto.js loaded, but createKallisto was not exported. Rebuild with the provided build script.');
  }

  const stdout = [];
  const stderr = [];

  const trackedInstantiation = await prepareTrackedInstantiation(moduleBase);
  const Module = await createKallisto({
    noInitialRun: true,
    print: (text) => {
      const line = String(text);
      stdout.push(line);
      post('stdout', { line });
    },
    printErr: (text) => {
      const line = String(text);
      markWebPerf(line, timing);
      stderr.push(line);
      post('stderr', { line });
    },
    locateFile: (path) => versionedUrl(path, moduleBase),
    mainScriptUrlOrBlob: kallistoScriptUrl,
    instantiateWasm: trackedInstantiation.instantiateWasm,
  });
  timing.runtime_ready = performance.now();

  if (!Module.FS || !Module.WORKERFS || typeof Module.callMain !== 'function') {
    throw new Error('The kallisto WASM build is missing FS/WORKERFS/callMain exports. Rebuild with the provided build script.');
  }

  const FS = Module.FS;
  ensureDir(FS, '/input');
  ensureDir(FS, '/output');

  const blobs = (payload.inputs || []).map((item, index) => ({
    name: sanitizeName(item.name, `input_${index}`),
    data: item.blob,
  }));

  timing.mount_begin = performance.now();
  FS.mount(Module.WORKERFS, { blobs }, '/input');

  for (const item of blobs) {
    const inputPath = `/input/${item.name}`;
    let size = Number(item.data?.size ?? 0);
    try { size = Number(FS.stat(inputPath).size); } catch (_) {}
    post('stderr', { line: `[web] mounted ${inputPath} (${size} bytes)` });
    if (!(size > 0)) throw new Error(`Mounted input is empty or unreadable: ${inputPath}`);
  }
  timing.mount_end = performance.now();

  const args = (payload.args || []).map((arg) => String(arg));
  const command = args[0] || '';
  post('status', { message: `Running kallisto ${command}...` });

  let exitCode = 0;
  timing.call_begin = performance.now();
  try {
    const result = Module.callMain(args);
    if (Number.isInteger(result)) exitCode = result;
  } catch (error) {
    if (error && (error.name === 'ExitStatus' || /ExitStatus/.test(String(error)))) {
      exitCode = Number(error.status ?? Module.EXITSTATUS ?? 0);
    } else {
      throw error;
    }
  }
  timing.call_end = performance.now();

  if (exitCode !== 0) {
    const recent = stderr.slice(-30).join('\n');
    const zeroProcessed = /processed\s+0\s+reads/i.test(stderr.join('\n'));
    const hint = zeroProcessed
      ? '\nFASTQ diagnostic: kallisto parsed zero reads. Check that the FASTQ is non-empty, has complete 4-line records, and that every quality string has exactly the same length as its sequence.'
      : '';
    throw new Error(`kallisto exited with code ${exitCode}.${hint}\n${recent}`);
  }

  timing.output_collection_begin = performance.now();
  const outputs = [];
  for (const outputPath of payload.outputPaths || []) {
    try {
      const bytes = FS.readFile(outputPath, { encoding: 'binary' });
      const copy = bytes.slice().buffer;
      outputs.push({ path: outputPath, name: outputPath.split('/').pop(), buffer: copy });
    } catch (error) {
      if (payload.optionalOutputs?.includes(outputPath)) continue;
      throw new Error(`Expected output was not produced: ${outputPath}. ${error}`);
    }
  }
  timing.output_collection_end = performance.now();

  try { FS.unmount('/input'); } catch (_) {}

  timing.request_end = performance.now();

  if (command === 'index' || command === 'quant') {
    outputs.push(makePerformanceOutput(timing, args, outputs, {
      operation: command,
      wasmInitialLinearMemoryBytes: trackedInstantiation.tracker.initialBytes,
      wasmLinearMemoryBytes: wasmLinearMemoryBytes(trackedInstantiation.tracker),
    }));
  }

  const transfer = outputs.map((file) => file.buffer);
  self.postMessage({
    type: 'result',
    result: {
      exitCode,
      stdout,
      stderr,
      outputs,
    },
  }, transfer);
}

function removeTree(FS, path) {
  let entries;
  try { entries = FS.readdir(path); } catch (_) { return; }
  for (const name of entries) {
    if (name === '.' || name === '..') continue;
    const child = `${path}/${name}`;
    try {
      const stat = FS.stat(child);
      if (FS.isDir(stat.mode)) {
        removeTree(FS, child);
        FS.rmdir(child);
      } else {
        FS.unlink(child);
      }
    } catch (_) {}
  }
}

function wasmLinearMemoryBytes(tracker) {
  return memoryBytes(tracker?.memory);
}

function freshBlobView(blob) {
  // Chromium normally permits a File to be read repeatedly, but a large File
  // that has been consumed to EOF must not share a WORKERFS Blob handle with a
  // later sample. Blob.slice() creates a new, zero-copy view of the same local
  // bytes and therefore resets the per-mount Blob lifetime without loading the
  // FASTQ into either the JavaScript or Wasm heap.
  if (blob && typeof blob.slice === 'function') {
    return blob.slice(0, blob.size, blob.type || 'application/octet-stream');
  }
  return blob;
}

function probeMountedInput(FS, path) {
  const stream = FS.open(path, 'r');
  try {
    const header = new Uint8Array(4);
    const bytesRead = FS.read(stream, header, 0, header.length, 0);
    if (bytesRead <= 0) throw new Error(`Mounted input cannot be read from byte 0: ${path}`);
    return header.subarray(0, bytesRead);
  } finally {
    FS.close(stream);
  }
}

function removeInputLinks(FS, paths) {
  for (const path of paths) {
    try { FS.unlink(path); } catch (_) {}
  }
  paths.length = 0;
}

async function runKallistoBatch(payload) {
  const batchStarted = performance.now();
  const runtimeTiming = { runtime_begin: performance.now() };
  const wrapperUrl = self.location.href;
  const kallistoScriptUrl = versionedUrl('../kallisto/kallisto.js', wrapperUrl);
  const moduleBase = new URL('../kallisto/', wrapperUrl);

  if (!self.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error('WebAssembly threads are unavailable. Serve this app with COOP/COEP headers.');
  }

  post('status', { message: 'Loading kallisto WebAssembly runtime...', stage: 'Initializing' });
  try {
    importScripts(kallistoScriptUrl);
  } catch (error) {
    throw new Error(`kallisto WebAssembly runtime was not found. ${error}`);
  }
  const createKallisto = self.createKallisto;
  if (typeof createKallisto !== 'function') {
    throw new Error('kallisto.js loaded, but createKallisto was not exported.');
  }

  let active = null;
  const trackedInstantiation = await prepareTrackedInstantiation(moduleBase);
  const Module = await createKallisto({
    noInitialRun: true,
    noExitRuntime: true,
    print: (text) => {
      const line = String(text);
      if (active) active.stdout.push(line);
      post('stdout', { line, sampleIndex: active?.sampleIndex, sample: active?.sample });
    },
    printErr: (text) => {
      const line = String(text);
      if (active) {
        markWebPerf(line, active.timing, (stage) => {
          post('status', {
            message: `${active.sample}: ${stage}`,
            stage,
            sampleIndex: active.sampleIndex,
            sample: active.sample,
          });
        });
        active.stderr.push(line);
      }
      post('stderr', { line, sampleIndex: active?.sampleIndex, sample: active?.sample });
    },
    locateFile: (path) => versionedUrl(path, moduleBase),
    mainScriptUrlOrBlob: kallistoScriptUrl,
    instantiateWasm: trackedInstantiation.instantiateWasm,
  });
  runtimeTiming.runtime_ready = performance.now();

  if (!Module.FS || !Module.WORKERFS || typeof Module.callMain !== 'function') {
    throw new Error('The kallisto WASM build is missing FS/WORKERFS/callMain exports.');
  }

  const FS = Module.FS;
  ensureDir(FS, '/reference');
  ensureDir(FS, '/reads');
  ensureDir(FS, '/read-mounts');
  ensureDir(FS, '/output');

  const reference = payload.reference;
  if (!reference?.blob) throw new Error('The shared reference index is missing.');
  const referenceMountBegin = performance.now();
  FS.mount(Module.WORKERFS, {
    blobs: [{ name: 'reference.idx', data: reference.blob }],
  }, '/reference');
  const referenceSize = Number(FS.stat('/reference/reference.idx').size);
  if (!(referenceSize > 0)) throw new Error('The mounted reference index is empty or unreadable.');
  post('stderr', { line: `[web] mounted shared /reference/reference.idx (${referenceSize} bytes)` });

  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  if (!samples.length) throw new Error('No samples were supplied for batch quantification.');

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const readsMountDir = `/read-mounts/sample_${sampleIndex + 1}`;
    const sampleStarted = performance.now();
    const timing = {
      request_start: sampleIndex === 0 ? batchStarted : sampleStarted,
      runtime_begin: sampleIndex === 0 ? runtimeTiming.runtime_begin : sampleStarted,
      runtime_ready: sampleIndex === 0 ? runtimeTiming.runtime_ready : sampleStarted,
      mount_begin: sampleIndex === 0 ? referenceMountBegin : sampleStarted,
    };
    const stdout = [];
    const stderr = [];
    active = { timing, stdout, stderr, sampleIndex, sample: sample.name };
    let readsMounted = false;
    const stableInputPaths = [];

    try {
      const blobs = (sample.inputs || []).map((item, index) => ({
        name: sanitizeName(item.name, `read_${index}`),
        data: freshBlobView(item.blob),
      }));
      ensureDir(FS, readsMountDir);
      FS.mount(Module.WORKERFS, { blobs }, readsMountDir);
      readsMounted = true;
      for (const item of blobs) {
        const mountedPath = `${readsMountDir}/${item.name}`;
        const inputPath = `/reads/${item.name}`;
        try { FS.unlink(inputPath); } catch (_) {}
        FS.symlink(mountedPath, inputPath);
        stableInputPaths.push(inputPath);
        const size = Number(FS.stat(inputPath).size);
        if (!(size > 0)) throw new Error(`Mounted input is empty or unreadable: ${inputPath}`);
        probeMountedInput(FS, inputPath);
        post('stderr', { line: `[web] mounted ${inputPath} (${size} bytes)`, sampleIndex, sample: sample.name });
      }
      timing.mount_end = performance.now();
      ensureDir(FS, sample.outputDir);

      post('status', {
        message: `${sample.name}: Loading index`,
        stage: 'Loading index',
        sampleIndex,
        sample: sample.name,
      });
      const args = (sample.args || []).map((arg) => String(arg));
      let exitCode = 0;
      timing.call_begin = performance.now();
      try {
        const result = Module.callMain(args);
        if (Number.isInteger(result)) exitCode = result;
      } catch (error) {
        if (error && (error.name === 'ExitStatus' || /ExitStatus/.test(String(error)))) {
          exitCode = Number(error.status ?? Module.EXITSTATUS ?? 0);
        } else {
          throw error;
        }
      }
      timing.call_end = performance.now();
      if (exitCode !== 0) {
        throw new Error(`kallisto exited with code ${exitCode}.\n${stderr.slice(-30).join('\n')}`);
      }

      timing.output_collection_begin = performance.now();
      const outputs = [];
      for (const outputPath of sample.outputPaths || []) {
        try {
          const bytes = FS.readFile(outputPath, { encoding: 'binary' });
          outputs.push({ path: outputPath, name: outputPath.split('/').pop(), buffer: bytes.slice().buffer });
        } catch (error) {
          throw new Error(`Expected output was not produced: ${outputPath}. ${error}`);
        }
      }
      timing.output_collection_end = performance.now();

      if (readsMounted) {
        removeInputLinks(FS, stableInputPaths);
        FS.unmount(readsMountDir);
        readsMounted = false;
      }
      try { FS.rmdir(readsMountDir); } catch (_) {}
      blobs.length = 0;
      sample.inputs = [];
      removeTree(FS, sample.outputDir);
      try { FS.rmdir(sample.outputDir); } catch (_) {}
      timing.request_end = performance.now();

      outputs.push(makePerformanceOutput(timing, args, outputs, {
        sample: sample.name,
        operation: 'quant',
        wasmInitialLinearMemoryBytes: trackedInstantiation.tracker.initialBytes,
        wasmLinearMemoryBytes: wasmLinearMemoryBytes(trackedInstantiation.tracker),
      }));
      const transfer = outputs.map((file) => file.buffer);
      self.postMessage({
        type: 'sample-result',
        sampleIndex,
        sample: sample.name,
        result: { exitCode, outputs },
      }, transfer);
      active = null;
    } catch (error) {
      if (readsMounted) {
        removeInputLinks(FS, stableInputPaths);
        try { FS.unmount(readsMountDir); } catch (_) {}
      }
      try { FS.rmdir(readsMountDir); } catch (_) {}
      sample.inputs = [];
      removeTree(FS, sample.outputDir);
      try { FS.rmdir(sample.outputDir); } catch (_) {}
      active = null;
      throw new Error(`Failed sample: ${sample.name}\n${error?.message || String(error)}`);
    }
  }

  try { FS.unmount('/reference'); } catch (_) {}
  post('batch-result', { result: { exitCode: 0, sampleCount: samples.length } });
}

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    if (message.type === 'run') {
      await runKallisto(message.payload || {});
    } else if (message.type === 'run-batch') {
      await runKallistoBatch(message.payload || {});
    }
  } catch (error) {
    post('error', { message: error?.stack || String(error) });
  }
};
