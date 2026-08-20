import { FastpClient } from '../runtime/fastp-client.mjs';

const statusElement = document.querySelector('#status');
const outputElement = document.querySelector('#output');
const lines = [];
const record = (line) => {
  lines.push(line);
  outputElement.textContent = `${lines.join('\n')}\n`;
};

const fetchBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};
const fetchJson = async (url) => JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
const gunzipText = async (bytes) => {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
};

const metricProjection = (report) => {
  const keys = [
    'total_reads', 'total_bases', 'q20_bases', 'q30_bases', 'q20_rate', 'q30_rate',
    'read1_mean_length', 'read2_mean_length', 'gc_content',
  ];
  const pick = (source) => Object.fromEntries(keys.map((key) => [key, source?.[key] ?? null]));
  return {
    fastp_version: report.fastp_version,
    before_filtering: pick(report.summary.before_filtering),
    after_filtering: pick(report.summary.after_filtering),
    filtering_result: report.filtering_result,
    adapter_cutting: report.adapter_cutting ?? null,
    insert_size: report.insert_size ?? null,
  };
};
const assertEqual = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} differs.`);
};

async function runCase(mode) {
  const client = new FastpClient();
  const isPe = mode === 'pe';
  const read1Name = isPe ? 'pe.R1.fastq.gz' : 'se.fastq.gz';
  const read1 = new File([await fetchBytes(`../../../test-data/fastp/inputs/${read1Name}`)], read1Name);
  const config = {
    mode,
    inputs: { read1 },
    options: {
      threads: 1,
      lengthRequired: 15,
      compression: 4,
      reportTitle: `fastp W2 ${mode.toUpperCase()} fixture`,
      disableAdapterTrimming: isPe,
      adapterSequence: isPe ? undefined : 'AGATCGGAAGAGCACACGTCTGAACTCCAGTCA',
    },
  };
  if (isPe) {
    const read2Name = 'pe.R2.fastq.gz';
    config.inputs.read2 = new File([await fetchBytes(`../../../test-data/fastp/inputs/${read2Name}`)], read2Name);
  }

  const started = performance.now();
  const result = await client.run(config, (event) => {
    if (event.type === 'running') record(`${mode.toUpperCase()} args: ${JSON.stringify(event.args)}`);
  });
  const wasmReport = JSON.parse(new TextDecoder().decode(result.outputs[`${mode}.fastp.json`]));
  const nativeReport = await fetchJson(`../../../test-data/fastp/native-v0.23.4/${mode}.fastp.json`);
  assertEqual(metricProjection(wasmReport), metricProjection(nativeReport), `${mode} QC metrics`);

  const outputs = isPe ? ['pe.R1.cleaned.fastq.gz', 'pe.R2.cleaned.fastq.gz'] : ['se.cleaned.fastq.gz'];
  for (const name of outputs) {
    const nativeBytes = await fetchBytes(`../../../test-data/fastp/native-v0.23.4/${name}`);
    assertEqual(await gunzipText(result.outputs[name]), await gunzipText(nativeBytes), `${name} records`);
  }
  if (!result.stderr.join('\n').includes('fastp v0.23.4')) throw new Error(`${mode} stderr was not captured.`);
  record(`${mode.toUpperCase()} passed in ${Math.round(performance.now() - started)} ms (exit ${result.exitCode}).`);
  return { mode, elapsedMs: Math.round(performance.now() - started), exitCode: result.exitCode, args: result.args };
}

async function runMalformed() {
  const client = new FastpClient();
  const name = 'malformed.fastq.gz';
  try {
    await client.run({
      mode: 'se',
      inputs: { read1: new File([await fetchBytes(`../../../test-data/fastp/inputs/${name}`)], name) },
      options: { threads: 1, disableAdapterTrimming: true },
    });
    throw new Error('Malformed FASTQ unexpectedly exited 0.');
  } catch (error) {
    const result = error.result;
    if (!result || result.exitCode === 0) throw error;
    if (!result.stderr.join('\n').includes('sequence and quality have different length')) throw error;
    record(`Malformed FASTQ propagated exit ${result.exitCode}.`);
    return { exitCode: result.exitCode };
  }
}

async function runCancellation() {
  const client = new FastpClient();
  const sequence = 'ACGT'.repeat(25);
  const quality = 'I'.repeat(100);
  const chunk = `@cancel-read\n${sequence}\n+\n${quality}\n`.repeat(100000);
  const input = new File([chunk], 'cancel.fastq');
  let reachedRunning = false;
  try {
    await client.run({
      mode: 'se',
      inputs: { read1: input },
      options: { threads: 1, disableAdapterTrimming: true },
    }, (event) => {
      if (event.type === 'running') {
        reachedRunning = true;
        client.cancel();
      }
    });
    throw new Error('Cancellation unexpectedly resolved.');
  } catch (error) {
    if (!reachedRunning || error.name !== 'AbortError') throw error;
    record('Cancellation passed after Worker entered running state.');
    return { reachedRunning, errorName: error.name };
  }
}

window.__fastpTestResult = { state: 'running' };
try {
  if (!crossOriginIsolated || typeof SharedArrayBuffer !== 'function') {
    throw new Error('Cross-origin isolation / SharedArrayBuffer is unavailable.');
  }
  const se = await runCase('se');
  const pe = await runCase('pe');
  const malformed = await runMalformed();
  const cancellation = await runCancellation();
  window.__fastpTestResult = { state: 'passed', se, pe, malformed, cancellation, crossOriginIsolated };
  statusElement.dataset.state = 'passed';
  statusElement.textContent = 'Passed: fastp-Wasm matches the native SE/PE baseline.';
  document.title = 'PASS — fastp-Wasm browser integration';
} catch (error) {
  console.error(error);
  record(`FAILED: ${error.stack || error.message || error}`);
  window.__fastpTestResult = { state: 'failed', message: error.message || String(error), stack: error.stack || null };
  statusElement.dataset.state = 'failed';
  statusElement.textContent = `Failed: ${error.message || error}`;
  document.title = 'FAIL — fastp-Wasm browser integration';
}
