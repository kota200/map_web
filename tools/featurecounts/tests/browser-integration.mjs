import { FeatureCountsClient } from '../runtime/featurecounts-client.mjs';

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
const countProjection = (text) => text.trim().split(/\r?\n/).filter((line) => !line.startsWith('#')).map((line, index) => {
  const fields = line.split('\t');
  if (index === 0) fields[fields.length - 1] = 'sample';
  return fields;
});
const summaryProjection = (text) => text.trim().split(/\r?\n/).map((line, index) => {
  const fields = line.split('\t');
  if (index === 0) fields[fields.length - 1] = 'sample';
  return fields;
});
const assertEqual = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} differs.`);
};

async function runCase(name, mode, annotationName) {
  const client = new FeatureCountsClient();
  const samName = mode === 'pe' ? 'pe.sam' : 'se.sam';
  const annotationUrl = annotationName.endsWith('.gff3')
    ? `../../../test-data/featurecounts/inputs/${annotationName}`
    : `../../../test-data/hisat2/inputs/${annotationName}`;
  const result = await client.run({
    mode,
    inputs: {
      sam: new File([await fetchBytes(`../../../test-data/hisat2/native/${samName}`)], samName),
      annotation: new File([await fetchBytes(annotationUrl)], annotationName),
    },
    options: { threads: 1, strandedness: 0, featureType: 'exon', attribute: 'gene_id' },
  });
  const nativeStem = name === 'gff3' ? 'gff3' : mode;
  const expectedCounts = await fetchText(`../../../test-data/featurecounts/native/${nativeStem}.counts.txt`);
  const expectedSummary = await fetchText(`../../../test-data/featurecounts/native/${nativeStem}.counts.txt.summary`);
  assertEqual(countProjection(result.outputs['featureCounts.txt']), countProjection(expectedCounts), `${name} counts`);
  assertEqual(summaryProjection(result.outputs['featureCounts.txt.summary']), summaryProjection(expectedSummary), `${name} summary`);
  const recordFields = countProjection(result.outputs['featureCounts.txt'])[1];
  record(`${name.toUpperCase()} passed: Length=${recordFields[5]}, count=${recordFields[6]} (exit ${result.exitCode}).`);
  return { name, exitCode: result.exitCode, length: Number(recordFields[5]), count: Number(recordFields[6]) };
}

async function runCancellation() {
  const client = new FeatureCountsClient();
  const header = '@HD\tVN:1.0\tSO:unsorted\n@SQ\tSN:chrTiny\tLN:240\n';
  const alignment = 'cancel\t0\tchrTiny\t11\t60\t40M\t*\t0\t0\tAACCCATCATATTGTGCCGGGCTTATCAGTAGTGTCCGAA\tIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII\n';
  let reachedRunning = false;
  try {
    await client.run({
      mode: 'se',
      inputs: {
        sam: new File([header + alignment.repeat(250000)], 'cancel.sam'),
        annotation: new File([await fetchBytes('../../../test-data/hisat2/inputs/annotation.gtf')], 'annotation.gtf'),
      },
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

window.__featureCountsTestResult = { state: 'running' };
try {
  if (!crossOriginIsolated || typeof SharedArrayBuffer !== 'function') {
    throw new Error('Cross-origin isolation / SharedArrayBuffer is unavailable.');
  }
  const se = await runCase('se', 'se', 'annotation.gtf');
  const pe = await runCase('pe', 'pe', 'annotation.gtf');
  const gff3 = await runCase('gff3', 'se', 'annotation.gff3');
  const cancellation = await runCancellation();
  window.__featureCountsTestResult = { state: 'passed', se, pe, gff3, cancellation, crossOriginIsolated };
  statusElement.dataset.state = 'passed';
  statusElement.textContent = 'Passed: featureCounts-Wasm matches native raw count, Length, and summary.';
  document.title = 'PASS — featureCounts-Wasm browser integration';
} catch (error) {
  console.error(error);
  record(`FAILED: ${error.stack || error.message || error}`);
  window.__featureCountsTestResult = { state: 'failed', message: error.message || String(error), stack: error.stack || null };
  statusElement.dataset.state = 'failed';
  statusElement.textContent = `Failed: ${error.message || error}`;
  document.title = 'FAIL — featureCounts-Wasm browser integration';
}
