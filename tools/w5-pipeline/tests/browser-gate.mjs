import { loadConfiguredCatalog } from '../../../js/index-catalog.mjs';
import { W4IndexCacheClient } from '../../w4-catalog/runtime/cache-client.mjs';
import { W3StorageClient } from '../../w3-storage/runtime/storage-client.mjs';
import { deleteRetainedArtifacts, Hisat2WebRunner, materializeOutput } from '../runtime/browser-runner.mjs';

const statusElement = document.querySelector('#status');
const outputElement = document.querySelector('#output');
const lines = [];

function record(message) { lines.push(message); outputElement.textContent = `${lines.join('\n')}\n`; }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function fileFromUrl(url, name) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new File([await response.blob()], name, { type: name.endsWith('.gz') ? 'application/gzip' : 'text/plain' });
}

async function gzipFile(file, name) {
  const stream = file.stream().pipeThrough(new CompressionStream('gzip'));
  return new File([await new Response(stream).blob()], name, { type: 'application/gzip' });
}

async function cleanupW5Storage() {
  const client = new W3StorageClient();
  try {
    const entries = await client.request('list');
    const targets = entries.filter((entry) => entry.entryId.startsWith('w5-'));
    for (const entry of targets) await client.request('remove', { entryId: entry.entryId });
    return targets.map((entry) => entry.entryId);
  } finally { client.close(); }
}

async function remainingW5Storage() {
  const client = new W3StorageClient();
  try { return (await client.request('list')).filter((entry) => entry.entryId.startsWith('w5-')); }
  finally { client.close(); }
}

function outputSource(result, path) {
  const source = result.outputSources.get(path);
  if (!source) throw new Error(`Missing output source: ${path}`);
  return source;
}

async function outputText(result, path) {
  return (await materializeOutput(outputSource(result, path))).text();
}

async function deleteReferenceCache(reference) {
  const client = new W4IndexCacheClient();
  try {
    const { cacheKey } = await client.request('cache-key', { reference });
    return await client.request('delete', { cacheKey });
  } finally { client.close(); }
}

window.__w5GateResult = { state: 'running' };
try {
  assert(crossOriginIsolated, 'Cross-origin isolation is unavailable.');
  assert(typeof navigator.storage?.getDirectory === 'function', 'OPFS is unavailable.');
  await cleanupW5Storage();
  const { config, catalog } = await loadConfiguredCatalog();
  assert(config.environment === 'local-test' && config.production_configured === false, 'W5 gate must use the explicit local test catalog.');
  const reference = catalog.references[0];
  const seFile = await fileFromUrl('../../../test-data/hisat2/inputs/se.fastq', '測定 SE.fastq');
  const peR1 = await fileFromUrl('../../../test-data/hisat2/inputs/pe_R1.fastq', 'paired_R1.fastq');
  const peR2 = await fileFromUrl('../../../test-data/hisat2/inputs/pe_R2.fastq', 'paired_R2.fastq');
  const malformed = await fileFromUrl('../../../test-data/fastp/inputs/malformed.fastq', 'malformed.fastq');

  const batchEvents = [];
  const batchStarted = performance.now();
  const batch = await new Hisat2WebRunner({ onEvent: (event) => batchEvents.push(event) }).run({
    reference,
    samples: [
      { name: 'SE α', mode: 'se', read1: [seFile] },
      { name: 'SE second', mode: 'se', read1: [seFile] },
    ],
    options: { threads: 1, runFastp: false, strandedness: 0, featureType: 'exon', attribute: 'gene_id' },
  });
  const batchElapsedMs = performance.now() - batchStarted;
  assert(batch.manifest.status === 'completed' && batch.samples.length === 2, 'Two-sample SE batch did not complete.');
  assert(batch.samples.every((sample) => sample.tpmRows[0].geneId === 'g1' && sample.tpmRows[0].length === 160 && sample.tpmRows[0].count === 2 && sample.tpmRows[0].tpm === 1_000_000), 'SE count/Length/TPM differs from baseline.');
  assert(batch.retainedArtifacts.length === 0, 'fastp-OFF batch retained an artifact.');
  const countsMatrix = await outputText(batch, 'counts_matrix.tsv');
  const tpmMatrix = await outputText(batch, 'tpm_matrix.tsv');
  assert(countsMatrix === 'Geneid\tLength\tSE α\tSE second\ng1\t160\t2\t2\n', 'Counts matrix is incorrect.');
  assert(tpmMatrix === 'Geneid\tLength\tSE α\tSE second\ng1\t160\t1000000\t1000000\n', 'TPM matrix is incorrect.');
  assert(batch.manifest.samples.every((sample) => !sample.outputs.some((output) => /fastp\//.test(output.relative_path))), 'fastp-OFF created empty fastp outputs.');
  assert(batchEvents.some((event) => event.stage === 'download') && batchEvents.some((event) => event.stage === 'featureCounts'), 'Typed W5 progress events are incomplete.');
  record(`SE batch passed in ${batchElapsedMs.toFixed(1)} ms.`);

  const gzipStarted = performance.now();
  const gzipInput = await gzipFile(seFile, 'lane 1.fq.gz');
  const gzipRun = await new Hisat2WebRunner().run({
    reference,
    samples: [{ name: 'SE gzip fastp OFF', mode: 'se', read1: [gzipInput] }],
    options: { threads: 1, runFastp: false, strandedness: 0, featureType: 'exon', attribute: 'gene_id' },
  });
  const gzipElapsedMs = performance.now() - gzipStarted;
  assert(gzipRun.samples[0].tpmRows[0].count === 2 && gzipRun.samples[0].tpmRows[0].tpm === 1_000_000, 'Raw .fq.gz result differs from baseline.');
  assert(gzipRun.retainedArtifacts.length === 0 && !(await remainingW5Storage()).length, 'Raw gzip path retained a temporary decompressed FASTQ.');
  record(`Raw .fq.gz fastp-OFF workflow passed in ${gzipElapsedMs.toFixed(1)} ms.`);

  const peStarted = performance.now();
  const paired = await new Hisat2WebRunner().run({
    reference,
    samples: [{ name: 'PE fragments', mode: 'pe', read1: [peR1], read2: [peR2] }],
    options: { threads: 1, runFastp: false, strandedness: 0, featureType: 'exon', attribute: 'gene_id' },
  });
  const peElapsedMs = performance.now() - peStarted;
  assert(paired.samples[0].tpmRows[0].count === 1 && paired.samples[0].tpmRows[0].length === 160 && paired.samples[0].tpmRows[0].tpm === 1_000_000, 'PE fragment result differs from baseline.');
  assert(paired.samples[0].runInfo.counting_unit === 'fragments', 'PE result was not labelled as fragment counting.');
  assert(paired.samples[0].runInfo.exact_arguments.featureCounts.includes('-p') && paired.samples[0].runInfo.exact_arguments.featureCounts.includes('--countReadPairs'), 'PE featureCounts arguments do not request fragment counting.');
  record(`PE fragment workflow passed in ${peElapsedMs.toFixed(1)} ms.`);

  const fastpStarted = performance.now();
  const fastp = await new Hisat2WebRunner().run({
    reference,
    samples: [{ name: 'SE fastp ON', mode: 'se', read1: [seFile] }],
    options: { threads: 1, runFastp: true, fastpLengthRequired: 15, strandedness: 0, featureType: 'exon', attribute: 'gene_id' },
  });
  const fastpElapsedMs = performance.now() - fastpStarted;
  assert(fastp.samples[0].tpmRows[0].count === 2, 'fastp-ON changed the accepted SE count.');
  assert(fastp.samples[0].runInfo.fastp.before.reads === 2 && fastp.samples[0].runInfo.fastp.after.reads === 2, 'fastp QC before/after counts are missing or incorrect.');
  assert(fastp.retainedArtifacts.length === 1, 'fastp SE cleaned FASTQ was not retained as an output.');
  const cleanedPath = [...fastp.outputSources.keys()].find((path) => path.endsWith('/fastp/se.cleaned.fastq.gz'));
  assert(cleanedPath && (await materializeOutput(outputSource(fastp, cleanedPath))).size > 0, 'Cleaned FASTQ is unavailable for download.');
  assert([...fastp.outputSources.keys()].some((path) => path.endsWith('/fastp/se.fastp.json')) && [...fastp.outputSources.keys()].some((path) => path.endsWith('/fastp/se.fastp.html')), 'fastp JSON/HTML outputs are missing.');
  const deletedFastp = await deleteRetainedArtifacts(fastp.retainedArtifacts);
  assert(deletedFastp.length === 1, 'Retained cleaned FASTQ cleanup failed.');
  record(`fastp-ON workflow passed in ${fastpElapsedMs.toFixed(1)} ms.`);

  let malformedError = null;
  try {
    await new Hisat2WebRunner().run({ reference, samples: [{ name: 'malformed', mode: 'se', read1: [malformed] }], options: { threads: 1 } });
  } catch (error) { malformedError = error; }
  assert(malformedError && /sequence and quality lengths differ|incomplete FASTQ/.test(malformedError.message), 'Malformed FASTQ was not rejected during preflight.');

  let zeroAssignedError = null;
  try {
    await new Hisat2WebRunner().run({
      reference,
      samples: [{ name: 'zero assigned', mode: 'se', read1: [seFile] }],
      options: { threads: 1, runFastp: false, strandedness: 0, featureType: 'missing_feature_type', attribute: 'gene_id' },
    });
  } catch (error) { zeroAssignedError = error; }
  assert(zeroAssignedError && (zeroAssignedError.name === 'ZeroAssignedError' || /featureCounts exited with code -?\d+/.test(zeroAssignedError.message)), `Zero-assigned featureCounts configuration was not rejected (${zeroAssignedError?.name}: ${zeroAssignedError?.message}).`);
  assert((await remainingW5Storage()).length === 0, 'Zero-assigned failure left W5 artifacts.');

  let cancelRunner;
  let cancellationIssued = false;
  cancelRunner = new Hisat2WebRunner({ onEvent(event) {
    if (!cancellationIssued && event.stage === 'hisat2' && /started/.test(event.message)) {
      cancellationIssued = true;
      cancelRunner.cancel();
    }
  } });
  let cancellationError = null;
  try {
    await cancelRunner.run({ reference, samples: [{ name: 'cancel', mode: 'se', read1: [seFile] }], options: { threads: 1 } });
  } catch (error) { cancellationError = error; }
  assert(cancellationIssued && cancellationError?.name === 'AbortError', `Running-state cancellation did not reject with AbortError (issued=${cancellationIssued}, name=${cancellationError?.name}, message=${cancellationError?.message}).`);
  assert(cancellationError.manifest?.status === 'cancelled' && cancellationError.manifest.cleanup.status === 'completed', `Cancellation manifest/cleanup is invalid: ${JSON.stringify(cancellationError.manifest)}.`);
  assert((await remainingW5Storage()).length === 0, 'W5 cancellation/final cleanup left OPFS job artifacts.');
  record('Malformed FASTQ, zero-assigned non-success, and running-state cancellation gates passed.');

  const deletion = await deleteReferenceCache(reference);
  const summary = {
    browser: { userAgent: navigator.userAgent, crossOriginIsolated },
    reference: { id: reference.id, bytes: reference.total_size, hisat2Version: reference.hisat2_version },
    seBatch: { samples: 2, elapsedMs: batchElapsedMs, count: 2, length: 160, tpm: 1_000_000, matrices: ['counts_matrix.tsv', 'tpm_matrix.tsv'] },
    rawGzip: { elapsedMs: gzipElapsedMs, extension: '.fq.gz', count: 2, retainedArtifacts: 0 },
    paired: { elapsedMs: peElapsedMs, count: 1, countingUnit: 'fragments' },
    fastpOn: { elapsedMs: fastpElapsedMs, beforeReads: 2, afterReads: 2, retainedThenDeleted: deletedFastp.length },
    malformed: { rejected: true, message: malformedError.message },
    zeroAssigned: { rejected: true, errorName: zeroAssignedError.name },
    cancellation: { issued: cancellationIssued, errorName: cancellationError.name, cleanup: cancellationError.manifest.cleanup },
    cleanup: { remainingW5Entries: 0, referenceCacheRemoved: deletion.removed },
  };
  window.__w5GateResult = { state: 'passed', summary };
  outputElement.dataset.result = JSON.stringify(summary);
  record(`RESULT ${JSON.stringify(summary)}`);
  statusElement.dataset.state = 'passed';
  statusElement.textContent = 'Passed: W5 SE/PE, raw gzip, fastp ON/OFF, TPM, matrices, zero-assigned failure, cancellation, and cleanup.';
  document.title = 'PASS — W5 HISAT2 Web pipeline gate';
} catch (error) {
  await cleanupW5Storage().catch(() => {});
  console.error(error);
  record(`FAILED: ${error.stack || error.message || error}`);
  window.__w5GateResult = { state: 'failed', message: error.message || String(error), stack: error.stack || null };
  statusElement.dataset.state = 'failed';
  statusElement.textContent = `Failed: ${error.message || error}`;
  document.title = 'FAIL — W5 HISAT2 Web pipeline gate';
}
