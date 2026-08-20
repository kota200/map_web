import { Hisat2Client } from '../runtime/hisat2-client.mjs';

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
const fetchText = async (url) => new TextDecoder().decode(await fetchBytes(url));
const semanticSam = (text) => text.trim().split(/\r?\n/).filter((line) => !line.startsWith('@PG'));
const assertEqual = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} differs.`);
};

async function loadIndex() {
  const entries = await Promise.all(Array.from({ length: 8 }, async (_, part) => {
    const name = `tiny.${part + 1}.ht2`;
    return [name, new File([await fetchBytes(`../../../test-data/hisat2/native/index/${name}`)], name)];
  }));
  return Object.fromEntries(entries);
}

async function runCase(mode, index) {
  const client = new Hisat2Client();
  const isPe = mode === 'pe';
  const read1Name = isPe ? 'pe_R1.fastq' : 'se.fastq';
  const config = {
    mode,
    inputs: {
      index,
      read1: new File([await fetchBytes(`../../../test-data/hisat2/inputs/${read1Name}`)], read1Name),
    },
    options: { threads: 1 },
  };
  if (isPe) {
    const read2Name = 'pe_R2.fastq';
    config.inputs.read2 = new File([await fetchBytes(`../../../test-data/hisat2/inputs/${read2Name}`)], read2Name);
  }
  const started = performance.now();
  const result = await client.run(config);
  const expected = await fetchText(`../../../test-data/hisat2/native/${mode}.sam`);
  assertEqual(semanticSam(result.outputs[`${mode}.sam`]), semanticSam(expected), `${mode} SAM`);
  if (!result.stderr.join('\n').includes('100.00% overall alignment rate')) {
    throw new Error(`${mode} stderr summary was not captured.`);
  }
  const elapsedMs = Math.round(performance.now() - started);
  record(`${mode.toUpperCase()} passed in ${elapsedMs} ms (exit ${result.exitCode}).`);
  return { mode, elapsedMs, exitCode: result.exitCode };
}

async function runCancellation(index) {
  const client = new Hisat2Client();
  const fastq = (`@cancel-read\n${'AACCCATCATATTGTGCCGGGCTTATCAGTAGTGTCCGAA'}\n+\n${'I'.repeat(40)}\n`).repeat(50000);
  let reachedRunning = false;
  try {
    await client.run({
      mode: 'se',
      inputs: { index, read1: new File([fastq], 'cancel.fastq') },
      options: { threads: 1 },
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

window.__hisat2TestResult = { state: 'running' };
try {
  if (!crossOriginIsolated || typeof SharedArrayBuffer !== 'function') {
    throw new Error('Cross-origin isolation / SharedArrayBuffer is unavailable.');
  }
  const index = await loadIndex();
  const se = await runCase('se', index);
  const pe = await runCase('pe', index);
  const cancellation = await runCancellation(index);
  window.__hisat2TestResult = { state: 'passed', se, pe, cancellation, crossOriginIsolated };
  statusElement.dataset.state = 'passed';
  statusElement.textContent = 'Passed: HISAT2-Wasm matches the native SE/PE/splice baseline.';
  document.title = 'PASS — HISAT2-Wasm browser integration';
} catch (error) {
  console.error(error);
  record(`FAILED: ${error.stack || error.message || error}`);
  window.__hisat2TestResult = { state: 'failed', message: error.message || String(error), stack: error.stack || null };
  statusElement.dataset.state = 'failed';
  statusElement.textContent = `Failed: ${error.message || error}`;
  document.title = 'FAIL — HISAT2-Wasm browser integration';
}
