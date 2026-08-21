import { KallistoRunner } from '../js/kallisto-client.js?v=20260820-w6';
import { MatrixBuilder } from '../js/batch-results.mjs';

const status = document.getElementById('regressionStatus');
const output = document.getElementById('regressionOutput');
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function describeError(error) {
  const name = error?.name || 'Error';
  const message = String(error?.message || error);
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  return stack.includes(message) ? stack : `${name}: ${message}${stack ? `\n${stack}` : ''}`;
}

function normalizeText(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

async function fetchBlob(path, type = 'application/octet-stream') {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return new Blob([await response.arrayBuffer()], { type });
}

async function fetchText(path) {
  return normalizeText(await (await fetch(path, { cache: 'no-store' })).text());
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function expectReject(promise, pattern, label) {
  try {
    await promise;
  } catch (error) {
    assert(pattern.test(String(error?.message || error)), `${label}: unexpected error: ${error}`);
    return String(error?.message || error);
  }
  throw new Error(`${label}: expected the operation to fail.`);
}

async function withTimeout(promise, milliseconds, label, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch (_) {}
      reject(new Error(`${label} timed out after ${milliseconds} ms.`));
    }, milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function countFastqRecords(blob, label) {
  const lines = normalizeText(await blob.text()).split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  assert(lines.length % 4 === 0, `${label}: truncated FASTQ record.`);
  for (let i = 0; i < lines.length; i += 4) {
    assert(lines[i].startsWith('@'), `${label}: record ${i / 4 + 1} is missing @.`);
    assert(lines[i + 2].startsWith('+'), `${label}: record ${i / 4 + 1} is missing +.`);
    assert(lines[i + 1].length === lines[i + 3].length, `${label}: sequence/quality length mismatch.`);
  }
  return lines.length / 4;
}

async function run() {
  assert(crossOriginIsolated, 'Cross-origin isolation is required for the pthread build.');
  const runner = new KallistoRunner();
  const runtime = await runner.checkRuntime();
  assert(runtime.ready, `Wasm runtime is unavailable: ${runtime.error || runtime.wasmStatus || 'unknown error'}`);

  const [fasta, r1, r2, r2Short, goldenAbundance, goldenCounts, goldenTpm, goldenMeta] = await Promise.all([
    fetchBlob('../test-data/transcripts.fa', 'text/plain'),
    fetchBlob('../test-data/reads_R1.fastq', 'text/plain'),
    fetchBlob('../test-data/reads_R2.fastq', 'text/plain'),
    fetchBlob('../test-data/reads_R2_short.fastq', 'text/plain'),
    fetchText('../test-data/golden/abundance.tsv'),
    fetchText('../test-data/golden/counts_matrix.tsv'),
    fetchText('../test-data/golden/tpm_matrix.tsv'),
    fetch('../test-data/golden/regression.json', { cache: 'no-store' }).then((response) => response.json()),
  ]);

  const indexResult = await runner.run({
    args: ['index', '-i', '/output/transcripts.idx', '-k', '31', '-t', '1', '/input/transcripts.fa'],
    inputs: [{ name: 'transcripts.fa', blob: fasta }],
    outputPaths: ['/output/transcripts.idx'],
  });
  const indexOutput = indexResult.outputs.find((item) => item.name === 'transcripts.idx');
  const indexPerformanceOutput = indexResult.outputs.find((item) => item.name === 'browser_performance.json');
  assert(indexOutput, 'Index build did not return transcripts.idx.');
  assert(indexPerformanceOutput, 'Index build did not return browser_performance.json.');
  const indexPerformance = JSON.parse(decoder.decode(indexPerformanceOutput.buffer));
  assert(indexPerformance.operation === 'index', 'Index performance report operation is incorrect.');
  assert(indexPerformance.wasm_peak_linear_memory_bytes >= indexPerformance.wasm_initial_linear_memory_bytes, 'Index Wasm memory high-water is missing.');
  assert(indexOutput.buffer.byteLength === goldenMeta.index_size_bytes, `Index size changed: ${indexOutput.buffer.byteLength}`);
  const indexHash = await sha256(indexOutput.buffer.slice(0));
  assert(indexHash === goldenMeta.index_sha256, `Index content changed: ${indexHash}`);

  let sampleResult = null;
  await runner.runBatch({
    reference: { name: 'reference.idx', blob: new Blob([indexOutput.buffer]) },
    samples: [{
      name: 'sample1',
      args: [
        'quant', '-i', '/reference/reference.idx', '-o', '/output/sample_1', '--plaintext',
        '-t', '1', '-b', '0', '--seed', '42',
        '/reads/R1_1_reads_R1.fastq', '/reads/R2_1_reads_R2.fastq',
      ],
      inputs: [
        { name: 'R1_1_reads_R1.fastq', blob: r1 },
        { name: 'R2_1_reads_R2.fastq', blob: r2 },
      ],
      outputDir: '/output/sample_1',
      outputPaths: ['/output/sample_1/abundance.tsv', '/output/sample_1/run_info.json'],
    }],
  }, (event) => {
    if (event.type === 'sample-result') sampleResult = event.result;
  });

  assert(sampleResult, 'Batch run did not emit a sample result.');
  const abundanceOutput = sampleResult.outputs.find((item) => item.name === 'abundance.tsv');
  const runInfoOutput = sampleResult.outputs.find((item) => item.name === 'run_info.json');
  const performanceOutput = sampleResult.outputs.find((item) => item.name === 'browser_performance.json');
  assert(abundanceOutput && runInfoOutput && performanceOutput, 'Expected abundance.tsv, run_info.json, and browser_performance.json outputs.');
  const abundance = normalizeText(decoder.decode(abundanceOutput.buffer));
  assert(abundance === goldenAbundance, 'abundance.tsv differs from the archived scientific baseline.');

  const runInfo = JSON.parse(decoder.decode(runInfoOutput.buffer));
  const performanceReport = JSON.parse(decoder.decode(performanceOutput.buffer));
  assert(runInfo.n_processed === goldenMeta.n_processed, `n_processed changed: ${runInfo.n_processed}`);
  assert(runInfo.n_pseudoaligned === goldenMeta.n_pseudoaligned, `n_pseudoaligned changed: ${runInfo.n_pseudoaligned}`);
  assert(performanceReport.wasm_initial_linear_memory_bytes === 268435456, `Unexpected initial Wasm memory: ${performanceReport.wasm_initial_linear_memory_bytes}`);
  assert(performanceReport.wasm_peak_linear_memory_bytes >= performanceReport.wasm_initial_linear_memory_bytes, 'Wasm memory high-water measurement is missing or invalid.');
  assert(performanceReport.wasm_peak_linear_memory_bytes === performanceReport.wasm_linear_memory_bytes, 'Final and high-water Wasm memory differ even though linear memory cannot shrink.');

  const matrixBuilder = new MatrixBuilder();
  matrixBuilder.addSample('sample1', abundanceOutput.buffer);
  const matrices = matrixBuilder.toMatrices();
  matrixBuilder.release();
  assert(normalizeText(matrices.counts) === goldenCounts, 'counts_matrix.tsv differs from baseline.');
  assert(normalizeText(matrices.tpm) === goldenTpm, 'tpm_matrix.tsv differs from baseline.');

  const r1Records = await countFastqRecords(r1, 'reads_R1.fastq');
  const r2ShortRecords = await countFastqRecords(r2Short, 'reads_R2_short.fastq');
  assert(r1Records !== r2ShortRecords, 'Mismatch fixture unexpectedly contains equal R1/R2 record counts.');
  const mismatchMessage = await expectReject(withTimeout(runner.runBatch({
    reference: { name: 'reference.idx', blob: new Blob([indexOutput.buffer]) },
    samples: [{
      name: 'mismatch',
      args: [
        'quant', '-i', '/reference/reference.idx', '-o', '/output/sample_1', '--plaintext',
        '-t', '1', '-b', '0', '--seed', '42',
        '/reads/R1_1_reads_R1.fastq', '/reads/R2_1_reads_R2_short.fastq',
      ],
      inputs: [
        { name: 'R1_1_reads_R1.fastq', blob: r1 },
        { name: 'R2_1_reads_R2_short.fastq', blob: r2Short },
      ],
      outputDir: '/output/sample_1',
      outputPaths: ['/output/sample_1/abundance.tsv', '/output/sample_1/run_info.json'],
    }],
  }), 10000, 'paired read-count mismatch', () => runner.cancel()),
  /mismatch|different|shorter|more records|fewer records/i, 'paired read-count mismatch');

  const cancellation = runner.run({ args: ['version'], inputs: [], outputPaths: [] });
  assert(runner.cancel(), 'Runner did not acknowledge cancellation.');
  const cancelMessage = await expectReject(cancellation, /stopped by user/i, 'worker cancellation');

  return {
    ok: true,
    runtime,
    index_size_bytes: indexOutput.buffer.byteLength,
    index_sha256: indexHash,
    index_wasm_peak_linear_memory_bytes: indexPerformance.wasm_peak_linear_memory_bytes,
    abundance_sha256: await sha256(encoder.encode(abundance).buffer),
    n_processed: runInfo.n_processed,
    n_pseudoaligned: runInfo.n_pseudoaligned,
    wasm_initial_linear_memory_bytes: performanceReport.wasm_initial_linear_memory_bytes,
    wasm_peak_linear_memory_bytes: performanceReport.wasm_peak_linear_memory_bytes,
    mismatch_error: mismatchMessage,
    cancel_error: cancelMessage,
  };
}

try {
  const result = await run();
  window.__regressionResult = result;
  status.textContent = 'PASS — archived kallisto index, quantification, mismatch, and cancellation checks succeeded.';
  status.className = 'callout-success';
  output.textContent = JSON.stringify(result, null, 2);
  document.documentElement.dataset.regression = 'passed';
} catch (error) {
  const result = { ok: false, error: describeError(error) };
  window.__regressionResult = result;
  status.textContent = 'FAIL — browser regression did not match the archived baseline.';
  status.className = 'callout-error';
  output.textContent = result.error;
  document.documentElement.dataset.regression = 'failed';
}
