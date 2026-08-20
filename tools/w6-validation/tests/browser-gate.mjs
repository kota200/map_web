import { KallistoRunner } from '../../../js/kallisto-client.js?v=20260820-w6';
import { loadConfiguredCatalog } from '../../../js/index-catalog.mjs';
import { W4IndexCacheClient } from '../../w4-catalog/runtime/cache-client.mjs';
import { W3StorageClient } from '../../w3-storage/runtime/storage-client.mjs';
import { Hisat2WebRunner } from '../../w5-pipeline/runtime/browser-runner.mjs';
import { KallistoFastpPreprocessor } from '../runtime/kallisto-fastp.mjs';
import { assertHisat2WebResources, estimateHisat2WebResources, WEB_RESOURCE_LIMITS } from '../runtime/resource-policy.mjs';

const statusElement = document.querySelector('#status');
const outputElement = document.querySelector('#output');
const lines = [];
const decoder = new TextDecoder();

function record(message) { lines.push(message); outputElement.textContent = `${lines.join('\n')}\n`; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function normalizeText(text) { return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }
function sanitizeName(name) { return String(name).replace(/[\\/]/g, '_').replace(/[^A-Za-z0-9._+\-]/g, '_'); }

async function fileFromUrl(url, name, type = 'text/plain') {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new File([await response.blob()], name, { type });
}

async function textFromUrl(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return normalizeText(await response.text());
}

async function expectReject(action, pattern, label) {
  try { await action(); }
  catch (error) {
    const message = String(error?.message || error);
    assert(pattern.test(`${error?.name || 'Error'}: ${message}`), `${label}: unexpected error: ${error?.name}: ${message}`);
    return { name: error?.name || 'Error', message };
  }
  throw new Error(`${label}: expected rejection.`);
}

async function cleanW6Storage() {
  const client = new W3StorageClient();
  try {
    const entries = await client.request('list');
    const targets = entries.filter((entry) => entry.entryId.startsWith('w6-kallisto-'));
    for (const entry of targets) await client.request('remove', { entryId: entry.entryId });
    return targets.length;
  } finally { client.close(); }
}

async function remainingW6Storage() {
  const client = new W3StorageClient();
  try { return (await client.request('list')).filter((entry) => entry.entryId.startsWith('w6-kallisto-')); }
  finally { client.close(); }
}

async function deleteReferenceCache(reference) {
  const client = new W4IndexCacheClient();
  try {
    const { cacheKey } = await client.request('cache-key', { reference });
    return await client.request('delete', { cacheKey });
  } finally { client.close(); }
}

function heapSnapshot() {
  const memory = performance.memory;
  return memory ? {
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
  } : null;
}

async function storageSnapshot() {
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? null, quota: estimate.quota ?? null };
}

function quantPayload(indexBlob, r1, r2) {
  const r1Name = `R1_1_${sanitizeName(r1.name)}`;
  const r2Name = `R2_1_${sanitizeName(r2.name)}`;
  return {
    reference: { name: 'reference.idx', blob: indexBlob },
    samples: [{
      name: 'w6-sample',
      args: [
        'quant', '-i', '/reference/reference.idx', '-o', '/output/sample_1', '--plaintext',
        '-t', '1', '-b', '0', '--seed', '42', `/reads/${r1Name}`, `/reads/${r2Name}`,
      ],
      inputs: [{ name: r1Name, blob: r1 }, { name: r2Name, blob: r2 }],
      outputDir: '/output/sample_1',
      outputPaths: ['/output/sample_1/abundance.tsv', '/output/sample_1/run_info.json'],
    }],
  };
}

async function runQuant(runner, indexBlob, r1, r2) {
  let sampleResult = null;
  const started = performance.now();
  await runner.runBatch(quantPayload(indexBlob, r1, r2), (event) => {
    if (event.type === 'sample-result') sampleResult = event.result;
  });
  assert(sampleResult, 'Kallisto batch did not emit a sample result.');
  const abundanceOutput = sampleResult.outputs.find((output) => output.name === 'abundance.tsv');
  const runInfoOutput = sampleResult.outputs.find((output) => output.name === 'run_info.json');
  const performanceOutput = sampleResult.outputs.find((output) => output.name === 'browser_performance.json');
  assert(abundanceOutput && runInfoOutput && performanceOutput, 'Kallisto outputs are incomplete.');
  return {
    elapsedMs: performance.now() - started,
    abundance: normalizeText(decoder.decode(abundanceOutput.buffer)),
    runInfo: JSON.parse(decoder.decode(runInfoOutput.buffer)),
    performance: JSON.parse(decoder.decode(performanceOutput.buffer)),
  };
}

window.__w6GateResult = { state: 'running' };
try {
  assert(crossOriginIsolated, 'Cross-origin isolation is unavailable.');
  assert(typeof navigator.storage?.getDirectory === 'function', 'OPFS is unavailable.');
  await cleanW6Storage();
  const before = { heap: heapSnapshot(), storage: await storageSnapshot() };

  const [fasta, r1, r2, goldenAbundance, goldenMeta] = await Promise.all([
    fileFromUrl('../../../test-data/transcripts.fa', 'transcripts.fa'),
    fileFromUrl('../../../test-data/reads_R1.fastq', 'reads_R1.fastq'),
    fileFromUrl('../../../test-data/reads_R2.fastq', 'reads_R2.fastq'),
    textFromUrl('../../../test-data/golden/abundance.tsv'),
    fetch('../../../test-data/golden/regression.json', { cache: 'no-store' }).then((response) => response.json()),
  ]);

  const kallisto = new KallistoRunner();
  const runtime = await kallisto.checkRuntime();
  assert(runtime.ready, `Kallisto Wasm runtime unavailable: ${runtime.error || runtime.wasmStatus || 'unknown'}`);
  const indexStarted = performance.now();
  const indexResult = await kallisto.run({
    args: ['index', '-i', '/output/transcripts.idx', '-k', '31', '-t', '1', '/input/transcripts.fa'],
    inputs: [{ name: 'transcripts.fa', blob: fasta }],
    outputPaths: ['/output/transcripts.idx'],
  });
  const indexElapsedMs = performance.now() - indexStarted;
  const indexOutput = indexResult.outputs.find((output) => output.name === 'transcripts.idx');
  assert(indexOutput?.buffer.byteLength === goldenMeta.index_size_bytes, 'Kallisto index differs from the archived baseline.');
  const indexBlob = new Blob([indexOutput.buffer]);

  const fastpOff = await runQuant(kallisto, indexBlob, r1, r2);
  assert(fastpOff.abundance === goldenAbundance, 'Kallisto fastp-OFF abundance differs from the archived baseline.');
  assert(fastpOff.runInfo.n_processed === goldenMeta.n_processed && fastpOff.runInfo.n_pseudoaligned === goldenMeta.n_pseudoaligned, 'Kallisto fastp-OFF run counters changed.');
  assert(fastpOff.performance.wasm_initial_linear_memory_bytes === 268435456, 'Kallisto initial Wasm memory measurement changed.');
  assert(fastpOff.performance.wasm_peak_linear_memory_bytes >= fastpOff.performance.wasm_initial_linear_memory_bytes, 'Kallisto fastp-OFF Wasm memory high-water is missing.');
  record(`Kallisto fastp OFF passed in ${fastpOff.elapsedMs.toFixed(1)} ms.`);

  const fastpEvents = [];
  const preprocessor = new KallistoFastpPreprocessor({ onEvent: (event) => fastpEvents.push(event) });
  const preprocessingStarted = performance.now();
  const preprocessed = await preprocessor.run([{ name: 'w6-sample', mode: 'paired', r1: [r1], r2: [r2] }], { threads: 1, lengthRequired: 15 });
  const preprocessingElapsedMs = performance.now() - preprocessingStarted;
  assert(preprocessed.samples.length === 1 && preprocessed.retainedEntries.length === 2, 'Kallisto fastp preprocessing did not retain two cleaned mates.');
  const processed = preprocessed.samples[0];
  assert(processed.qc.before.reads === goldenMeta.n_processed * 2 && processed.qc.after.reads === goldenMeta.n_processed * 2, 'Kallisto fastp QC read totals are incorrect.');
  assert(fastpEvents.some((event) => /Exact arguments:/.test(event.message)), 'Kallisto fastp exact arguments were not emitted.');
  const fastpOn = await runQuant(kallisto, indexBlob, processed.processed.r1[0], processed.processed.r2[0]);
  assert(fastpOn.abundance === goldenAbundance, 'Kallisto fastp-ON abundance differs from fastp OFF.');
  assert(fastpOn.runInfo.n_processed === fastpOff.runInfo.n_processed && fastpOn.runInfo.n_pseudoaligned === fastpOff.runInfo.n_pseudoaligned, 'Kallisto fastp ON/OFF counters differ.');
  assert(fastpOn.performance.wasm_peak_linear_memory_bytes >= fastpOn.performance.wasm_initial_linear_memory_bytes, 'Kallisto fastp-ON Wasm memory high-water is missing.');
  const removed = await preprocessor.cleanup(preprocessed.retainedEntries);
  assert(removed.length === 2 && (await remainingW6Storage()).length === 0, 'Kallisto fastp retained-output cleanup failed.');
  record(`Kallisto fastp ON passed (preprocess ${preprocessingElapsedMs.toFixed(1)} ms; quant ${fastpOn.elapsedMs.toFixed(1)} ms).`);

  let cancelPreprocessor;
  let cancellationIssued = false;
  cancelPreprocessor = new KallistoFastpPreprocessor({ onEvent(event) {
    if (!cancellationIssued && event.stage === 'fastp' && /command started/.test(event.message)) {
      cancellationIssued = true;
      cancelPreprocessor.cancel();
    }
  } });
  const cancellation = await expectReject(
    () => cancelPreprocessor.run([{ name: 'cancel-fastp', mode: 'paired', r1: [r1], r2: [r2] }], { threads: 1, lengthRequired: 15 }),
    /AbortError|stopped by user/i,
    'Kallisto fastp cancellation',
  );
  assert(cancellationIssued && cancellation.name === 'AbortError', 'Kallisto fastp cancellation was not acknowledged as AbortError.');
  assert((await remainingW6Storage()).length === 0, 'Kallisto fastp cancellation left OPFS entries.');
  record('Kallisto fastp running-state cancellation and OPFS cleanup passed.');

  const representative = estimateHisat2WebResources({
    referenceBytes: 4_203_807,
    samples: [{ read1: [{ name: 'example_R1.fq.gz', size: 1_550_059_107 }], read2: [{ name: 'example_R2.fq.gz', size: 1_552_453_396 }] }],
    runFastp: false,
  });
  assert(representative.recommendDesktop && representative.temporaryBytes >= 2 * 1024 ** 3, 'Representative example-data estimate did not recommend desktop.');
  const storageError = await expectReject(
    () => Promise.resolve().then(() => assertHisat2WebResources({ referenceBytes: 1, samples: [{ read1: [{ name: 'reads.fastq', size: 1024 }] }], availableBytes: 1 })),
    /QuotaPreflightError|storage requirement/i,
    'storage preflight',
  );
  const memoryError = await expectReject(
    () => Promise.resolve().then(() => assertHisat2WebResources({ referenceBytes: WEB_RESOURCE_LIMITS.conservativeIndexPayloadBytes, samples: [] })),
    /WebResourceLimitError|validated Web reference envelope/i,
    'Wasm memory-envelope preflight',
  );
  record('Storage and Wasm memory-envelope failure messages passed.');

  const { catalog } = await loadConfiguredCatalog();
  const reference = catalog.references[0];
  const hisatSe = await fileFromUrl('../../../test-data/hisat2/inputs/se.fastq', 'se.fastq');
  const badChecksum = {
    ...reference,
    files: reference.files.map((file, index) => index === 0 ? { ...file, sha256: '0'.repeat(64) } : { ...file }),
    annotation: { ...reference.annotation, contigs: [...reference.annotation.contigs] },
    contigs: reference.contigs.map((contig) => ({ ...contig })),
  };
  const checksumError = await expectReject(
    () => new Hisat2WebRunner().run({ reference: badChecksum, samples: [{ name: 'checksum', mode: 'se', read1: [hisatSe] }], options: { threads: 1 } }),
    /IntegrityError|SHA-256 mismatch/i,
    'hosted-index checksum',
  );
  await deleteReferenceCache(badChecksum).catch(() => {});

  const mismatchReference = {
    ...reference,
    annotation: { ...reference.annotation, contigs: ['chrMissing'] },
    contigs: [...reference.contigs.map((contig) => ({ ...contig })), { name: 'chrMissing', length: 1 }],
  };
  const annotationError = await expectReject(
    () => new Hisat2WebRunner().run({ reference: mismatchReference, samples: [{ name: 'annotation mismatch', mode: 'se', read1: [hisatSe] }], options: { threads: 1 } }),
    /IntegrityError|Declared annotation contig chrMissing was not found/i,
    'annotation/index contig mismatch',
  );
  await deleteReferenceCache(mismatchReference).catch(() => {});
  record('Hosted checksum and annotation/index-contig mismatch messages passed.');

  const after = { heap: heapSnapshot(), storage: await storageSnapshot() };
  const summary = {
    browser: { userAgent: navigator.userAgent, crossOriginIsolated },
    observations: { before, after },
    kallisto: {
      runtime,
      index: { bytes: indexOutput.buffer.byteLength, elapsedMs: indexElapsedMs },
      fastpOff: { elapsedMs: fastpOff.elapsedMs, nProcessed: fastpOff.runInfo.n_processed, nPseudoaligned: fastpOff.runInfo.n_pseudoaligned, wasmPeakLinearMemoryBytes: fastpOff.performance.wasm_peak_linear_memory_bytes },
      fastpOn: { preprocessingElapsedMs, quantElapsedMs: fastpOn.elapsedMs, beforeReads: processed.qc.before.reads, afterReads: processed.qc.after.reads, wasmPeakLinearMemoryBytes: fastpOn.performance.wasm_peak_linear_memory_bytes },
      cancellation,
      remainingW6Entries: 0,
    },
    resources: { representative, storageError, memoryError },
    failures: { checksumError, annotationError },
  };
  window.__w6GateResult = { state: 'passed', summary };
  outputElement.dataset.result = JSON.stringify(summary);
  record(`RESULT ${JSON.stringify(summary)}`);
  statusElement.dataset.state = 'passed';
  statusElement.textContent = 'Passed: Kallisto fastp OFF/ON, cleanup, resource, checksum, and annotation-mismatch Web gates.';
  document.title = 'PASS — W6 Web validation gate';
} catch (error) {
  await cleanW6Storage().catch(() => {});
  console.error(error);
  record(`FAILED: ${error.stack || error.message || error}`);
  window.__w6GateResult = { state: 'failed', message: error.message || String(error), stack: error.stack || null };
  statusElement.dataset.state = 'failed';
  statusElement.textContent = `Failed: ${error.message || error}`;
  document.title = 'FAIL — W6 Web validation gate';
}
