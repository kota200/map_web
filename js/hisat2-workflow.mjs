import { loadConfiguredCatalog } from './index-catalog.mjs';
import { buildFastpArguments } from '../tools/fastp/runtime/fastp-runner.mjs';
import { buildHisat2Arguments } from '../tools/hisat2/runtime/hisat2-runner.mjs';
import { buildFeatureCountsArguments } from '../tools/featurecounts/runtime/featurecounts-runner.mjs';
import { deleteRetainedArtifacts, Hisat2WebRunner, materializeOutput } from '../tools/w5-pipeline/runtime/browser-runner.mjs';
import { safeSampleId } from '../tools/w5-pipeline/runtime/preflight.mjs';
import { assertHisat2WebResources, estimateHisat2WebResources } from '../tools/w6-validation/runtime/resource-policy.mjs';

const $ = (selector) => document.querySelector(selector);
const elements = {
  catalogBoundary: $('#catalogBoundary'), environmentStatus: $('#environmentStatus'), jobStatus: $('#jobStatus'), stageStatus: $('#stageStatus'),
  referenceSelect: $('#referenceSelect'), referenceAssembly: $('#referenceAssembly'), referenceEngine: $('#referenceEngine'), referenceAnnotation: $('#referenceAnnotation'), referenceSize: $('#referenceSize'),
  sampleCards: $('#w5SampleCards'), addSample: $('#addW5Sample'), runFastp: $('#runFastp'), threads: $('#w5Threads'), strandedness: $('#w5Strandedness'),
  featureType: $('#w5FeatureType'), attribute: $('#w5Attribute'), fastpLengthField: $('#fastpLengthField'), fastpLength: $('#fastpLength'), commandPreview: $('#w5CommandPreview'),
  resourceEstimate: $('#w6ResourceEstimate'), resourceDecision: $('#w6ResourceDecision'),
  preflight: $('#w5Preflight'), run: $('#runW5'), cancel: $('#cancelW5'), progress: $('#w5Progress'), progressLabel: $('#w5ProgressLabel'), progressBar: $('#w5ProgressBar'),
  progressDetail: $('#w5ProgressDetail'), elapsed: $('#w5Elapsed'), log: $('#w5Log'), results: $('#w5Results'), summary: $('#w5Summary'), warnings: $('#w5Warnings'),
  batchOutputs: $('#w5BatchOutputs'), sampleOutputs: $('#w5SampleOutputs'), downloadManifest: $('#downloadManifest'), deleteCleanedFastq: $('#deleteCleanedFastq'), cleanupStatus: $('#w5CleanupStatus'),
};

const state = {
  environmentReady: false,
  references: [],
  reference: null,
  samples: [],
  running: false,
  cancelRequested: false,
  result: null,
  deletedEntries: new Set(),
  timer: null,
  startedAt: 0,
  resource: null,
  resourceRequest: 0,
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown size';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

function mode() { return document.querySelector('input[name="w5ReadMode"]:checked')?.value ?? 'se'; }
function files(input) { return Array.from(input.files || []); }

function fileSummary(input, empty) {
  const selected = files(input);
  if (!selected.length) return empty;
  const bytes = selected.reduce((total, file) => total + file.size, 0);
  const names = selected.length > 3 ? `${selected.slice(0, 3).map((file) => file.name).join(', ')} +${selected.length - 3} more` : selected.map((file) => file.name).join(', ');
  return `${selected.length} file${selected.length === 1 ? '' : 's'} · ${formatBytes(bytes)} · ${names}`;
}

function makeFastqPicker(labelText) {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-picker-card';
  const label = document.createElement('label');
  const labelCopy = document.createElement('span');
  labelCopy.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.fastq,.fq,.fastq.gz,.fq.gz,text/plain,application/gzip';
  const meta = document.createElement('p');
  meta.className = 'file-meta';
  meta.textContent = 'No FASTQ files selected.';
  label.append(labelCopy, input);
  wrapper.append(label, meta);
  input.addEventListener('change', () => {
    meta.textContent = fileSummary(input, 'No FASTQ files selected.');
    refresh();
  });
  return { wrapper, input, meta };
}

function refreshSampleCards() {
  const readMode = mode();
  for (const [index, sample] of state.samples.entries()) {
    sample.number.textContent = `Sample ${index + 1}`;
    sample.r1Label.textContent = readMode === 'pe' ? 'Read 1 FASTQ file(s)' : 'Single-end FASTQ file(s)';
    sample.r2.wrapper.hidden = readMode !== 'pe';
    sample.remove.disabled = state.running || state.samples.length === 1;
    sample.name.disabled = state.running;
    sample.r1.input.disabled = state.running;
    sample.r2.input.disabled = state.running;
  }
}

function addSample() {
  const used = new Set(state.samples.map((sample) => sample.name.value.trim()));
  let next = 1;
  while (used.has(`sample${next}`)) next += 1;
  const card = document.createElement('article');
  card.className = 'sample-card';
  const head = document.createElement('div');
  head.className = 'sample-card-head';
  const number = document.createElement('h3');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove-sample-button';
  remove.textContent = 'Remove';
  head.append(number, remove);
  const nameLabel = document.createElement('label');
  const nameCopy = document.createElement('span');
  nameCopy.textContent = 'Sample name';
  const name = document.createElement('input');
  name.type = 'text';
  name.maxLength = 120;
  name.value = `sample${next}`;
  nameLabel.append(nameCopy, name);
  const reads = document.createElement('div');
  reads.className = 'sample-read-grid';
  const r1 = makeFastqPicker('Single-end FASTQ file(s)');
  const r1Label = r1.wrapper.querySelector('label > span');
  const r2 = makeFastqPicker('Read 2 FASTQ file(s)');
  reads.append(r1.wrapper, r2.wrapper);
  card.append(head, nameLabel, reads);
  const sample = { card, number, remove, name, r1, r1Label, r2 };
  state.samples.push(sample);
  elements.sampleCards.append(card);
  name.addEventListener('input', refresh);
  remove.addEventListener('click', () => {
    if (state.running || state.samples.length === 1) return;
    state.samples.splice(state.samples.indexOf(sample), 1);
    card.remove();
    refresh();
  });
  refresh();
}

function selectedSamples() {
  const readMode = mode();
  return state.samples.map((sample) => ({
    name: sample.name.value,
    mode: readMode,
    read1: files(sample.r1.input),
    ...(readMode === 'pe' ? { read2: files(sample.r2.input) } : {}),
  }));
}

function quickValidation() {
  if (!state.environmentReady) return { ok: false, message: 'This browser is missing a required cross-origin-isolated Web/OPFS capability.' };
  if (!state.reference) return { ok: false, message: 'Choose a hosted reference package.' };
  const names = new Set();
  for (const [index, sample] of selectedSamples().entries()) {
    const name = sample.name.trim();
    if (!name) return { ok: false, message: `Sample ${index + 1} needs a name.` };
    if (names.has(name)) return { ok: false, message: `Duplicate sample name: ${name}.` };
    names.add(name);
    if (!sample.read1.length) return { ok: false, message: `${name}: select at least one ${sample.mode === 'pe' ? 'R1' : 'single-end'} FASTQ file.` };
    if (sample.mode === 'pe' && sample.read1.length !== sample.read2.length) return { ok: false, message: `${name}: R1 and R2 file counts must match.` };
  }
  if (!elements.featureType.value.trim()) return { ok: false, message: 'Annotation feature type must not be empty.' };
  if (!elements.attribute.value.trim()) return { ok: false, message: 'Grouping attribute must not be empty.' };
  if (state.resource && !state.resource.supported) return { ok: false, message: `Resource preflight: ${state.resource.errors.join(' ')}` };
  return { ok: true, message: `${state.samples.length} sample${state.samples.length === 1 ? '' : 's'} ready for structural FASTQ preflight and local execution.` };
}

async function updateResourceEstimate() {
  const request = ++state.resourceRequest;
  const storage = await navigator.storage?.estimate?.().catch(() => ({})) || {};
  if (request !== state.resourceRequest) return state.resource;
  const available = Number.isFinite(storage.quota) && Number.isFinite(storage.usage) ? storage.quota - storage.usage : null;
  const estimate = estimateHisat2WebResources({
    referenceBytes: state.reference?.total_size || 0,
    samples: selectedSamples(),
    runFastp: elements.runFastp.checked,
    availableBytes: available,
  });
  state.resource = estimate;
  elements.resourceEstimate.textContent = estimate.inputBytes
    ? `Inputs ${formatBytes(estimate.inputBytes)} · reference ${formatBytes(estimate.referenceBytes)} · estimated temporary data ${formatBytes(estimate.temporaryBytes)} · required with headroom ${formatBytes(estimate.requiredStorageBytes)}${Number.isFinite(available) ? ` · ${formatBytes(available)} available` : ''}. ${estimate.warnings.at(-1)}`
    : `Reference ${formatBytes(estimate.referenceBytes)}. Select FASTQ files to estimate decompressed FASTQ and SAM storage.`;
  elements.resourceDecision.className = `runtime-badge ${estimate.supported ? (estimate.recommendDesktop ? 'is-error' : 'is-ready') : 'is-error'}`;
  elements.resourceDecision.textContent = !estimate.supported ? 'Web preflight blocked' : estimate.recommendDesktop ? 'Desktop recommended' : 'Within W5 measured scale';
  return estimate;
}

function previewArguments() {
  if (!state.reference) return 'Reference catalog is still loading.';
  const firstName = state.samples[0]?.name.value.trim() || 'sample1';
  const sampleId = safeSampleId(firstName, 0);
  const readMode = mode();
  const threads = Number(elements.threads.value);
  const firstInput = state.samples[0]?.r1.input.files?.[0];
  const gzip = /\.gz$/i.test(firstInput?.name || '');
  const inputSuffix = `.fastq${gzip ? '.gz' : ''}`;
  const dummy = new Blob(['x']);
  const index = Object.fromEntries(Array.from({ length: 8 }, (_, indexPart) => [`tiny.${indexPart + 1}.ht2`, dummy]));
  const hisat2 = buildHisat2Arguments({ mode: readMode, inputs: { read1: dummy, ...(readMode === 'pe' ? { read2: dummy } : {}), index }, options: { threads } }, {
    read1: '/input/read1.fastq', read2: readMode === 'pe' ? '/input/read2.fastq' : null, output: `/output/${readMode}.sam`,
  });
  const featureCounts = buildFeatureCountsArguments({
    mode: readMode, inputs: { sam: dummy, annotation: dummy }, options: { threads, strandedness: Number(elements.strandedness.value), featureType: elements.featureType.value.trim() || 'exon', attribute: elements.attribute.value.trim() || 'gene_id' },
  }, { sam: `/input/${readMode}.sam`, annotation: `/input/${state.reference.annotation.name}` });
  const lines = [];
  if (elements.runFastp.checked) {
    const fastp = buildFastpArguments({
      mode: readMode, inputs: { read1: dummy, ...(readMode === 'pe' ? { read2: dummy } : {}) }, options: { threads, lengthRequired: Number(elements.fastpLength.value), compression: 4, reportTitle: `${firstName} fastp preprocessing` },
    }, { read1: `/input/${sampleId}-read1${inputSuffix}`, read2: readMode === 'pe' ? `/input/${sampleId}-read2${inputSuffix}` : null });
    lines.push(`fastp ${JSON.stringify(fastp)}`);
  } else {
    lines.push('fastp OFF');
  }
  lines.push(`hisat2-align-s ${JSON.stringify(hisat2)}`);
  lines.push(`featureCounts ${JSON.stringify(featureCounts)}`);
  lines.push('Temporary SAM: not included in downloads; removed after counting.');
  return lines.join('\n');
}

function showReference(reference, resetAnnotationDefaults = true) {
  state.reference = reference;
  elements.referenceAssembly.textContent = `${reference.organism} · ${reference.assembly}`;
  elements.referenceEngine.textContent = `HISAT2 ${reference.hisat2_version} · ${reference.index_format}`;
  elements.referenceAnnotation.textContent = `${reference.annotation.format} ${reference.annotation.version}`;
  elements.referenceSize.textContent = `${formatBytes(reference.total_size)} · ${reference.files.length + 1} checksum-verified files`;
  if (resetAnnotationDefaults) {
    elements.featureType.value = reference.annotation.default_feature_type;
    elements.attribute.value = reference.annotation.default_grouping_attribute;
  }
  refresh();
}

function refresh() {
  refreshSampleCards();
  const validation = quickValidation();
  elements.preflight.className = validation.ok ? 'callout-success' : 'callout-warning';
  elements.preflight.textContent = validation.message;
  elements.run.disabled = state.running || !validation.ok;
  elements.cancel.disabled = !state.running;
  elements.addSample.disabled = state.running;
  elements.referenceSelect.disabled = state.running || state.references.length === 0;
  for (const input of document.querySelectorAll('input[name="w5ReadMode"], #runFastp, #w5Threads, #w5Strandedness, #w5FeatureType, #w5Attribute, #fastpLength')) input.disabled = state.running;
  elements.fastpLengthField.hidden = !elements.runFastp.checked;
  elements.commandPreview.textContent = previewArguments();
  updateResourceEstimate().then(() => {
    const validation = quickValidation();
    elements.preflight.className = validation.ok ? 'callout-success' : 'callout-warning';
    elements.preflight.textContent = validation.message;
    elements.run.disabled = state.running || !validation.ok;
  }).catch((error) => {
    elements.resourceDecision.className = 'runtime-badge is-error';
    elements.resourceDecision.textContent = 'Estimate unavailable';
    elements.resourceEstimate.textContent = error.message || String(error);
  });
}

function appendLog(event) {
  const sample = event.sample ? `[${event.sample}] ` : '';
  const level = event.type === 'log' && event.level !== 'info' ? `[${event.level}] ` : '';
  elements.log.hidden = false;
  elements.log.textContent += `${event.timestamp} ${sample}${level}${event.stage}: ${event.message}\n`;
  elements.log.scrollTop = elements.log.scrollHeight;
}

function onRunnerEvent(event) {
  appendLog(event);
  elements.stageStatus.textContent = event.sample ? `${event.stage} · ${event.sample}` : event.stage;
  elements.progressLabel.textContent = event.message;
  if (event.kind === 'determinate' && Number.isFinite(event.total) && event.total > 0) {
    elements.progress.classList.remove('is-running');
    elements.progressBar.style.width = `${Math.max(0, Math.min(100, (event.completed / event.total) * 100))}%`;
    elements.progressDetail.textContent = `${event.completed} / ${event.total} ${event.unit || ''}`.trim();
  } else if (event.type === 'progress') {
    elements.progress.classList.add('is-running');
    elements.progressBar.style.width = '';
    elements.progressDetail.textContent = event.sample ? `Current sample: ${event.sample}` : 'Working locally';
  }
}

function startTimer() {
  state.startedAt = performance.now();
  clearInterval(state.timer);
  const update = () => { elements.elapsed.textContent = `${((performance.now() - state.startedAt) / 1000).toFixed(1)} sec`; };
  update();
  state.timer = setInterval(update, 100);
}

function stopTimer() {
  clearInterval(state.timer);
  state.timer = null;
  elements.elapsed.textContent = `${((performance.now() - state.startedAt) / 1000).toFixed(1)} sec`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeDownloadName(path) { return path.replaceAll('/', '__').replace(/[^A-Za-z0-9._-]+/g, '_'); }

function outputCard(output, source) {
  const card = document.createElement('article');
  card.className = 'result-file-card';
  const title = document.createElement('h4');
  title.textContent = output.relative_path;
  const meta = document.createElement('p');
  meta.textContent = `${output.role} · ${formatBytes(output.size_bytes)}${output.sha256 ? ' · SHA-256 recorded' : ' · OPFS-backed'}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'download-button';
  button.textContent = 'Download';
  button.disabled = !source || (source.kind === 'opfs' && state.deletedEntries.has(source.entryId));
  button.addEventListener('click', async () => {
    button.disabled = true;
    const prior = button.textContent;
    button.textContent = 'Preparing…';
    try { downloadBlob(await materializeOutput(source), safeDownloadName(output.relative_path)); }
    catch (error) { elements.cleanupStatus.textContent = `Download failed: ${error.message || error}`; }
    finally {
      button.textContent = prior;
      button.disabled = source?.kind === 'opfs' && state.deletedEntries.has(source.entryId);
    }
  });
  card.append(title, meta, button);
  return card;
}

function summaryCard(label, value, detail) {
  const card = document.createElement('div');
  card.className = 'summary-card';
  const strong = document.createElement('strong'); strong.textContent = value;
  const span = document.createElement('span'); span.textContent = label;
  const small = document.createElement('small'); small.textContent = detail;
  card.append(strong, span, small);
  return card;
}

function renderResults(result, { preserveDeleted = false } = {}) {
  state.result = result;
  if (!preserveDeleted) state.deletedEntries.clear();
  const totalMs = result.samples.reduce((sum, sample) => sum + sample.runInfo.timings_ms.totalMs, 0);
  const assigned = result.samples.reduce((sum, sample) => sum + Number(sample.runInfo.featureCounts.assignment_summary.Assigned || 0), 0);
  const geneRows = result.samples.reduce((sum, sample) => sum + sample.tpmRows.length, 0);
  elements.summary.replaceChildren(
    summaryCard('Completed samples', String(result.samples.length), 'Sequential WebAssembly execution'),
    summaryCard('Assigned reads / fragments', String(assigned), 'featureCounts Assigned total'),
    summaryCard('Gene rows', String(geneRows), 'Across sample count tables'),
    summaryCard('Analysis time', `${(totalMs / 1000).toFixed(2)} s`, 'Sum of per-sample timings'),
  );
  const warnings = result.manifest.warnings;
  elements.warnings.hidden = warnings.length === 0;
  elements.warnings.textContent = warnings.join('\n');
  elements.batchOutputs.replaceChildren(...result.manifest.outputs.map((output) => outputCard(output, result.outputSources.get(output.relative_path))));
  elements.sampleOutputs.replaceChildren(...result.samples.map((sample) => {
    const card = document.createElement('article');
    card.className = 'sample-result-card';
    const head = document.createElement('div');
    head.className = 'sample-result-head';
    const title = document.createElement('h4'); title.textContent = sample.name;
    const status = document.createElement('strong'); status.className = 'status-completed'; status.textContent = `✓ Completed · ${sample.runInfo.counting_unit}`;
    head.append(title, status);
    const metrics = document.createElement('p');
    const assignedValue = sample.runInfo.featureCounts.assignment_summary.Assigned ?? 0;
    metrics.className = 'small-note';
    metrics.textContent = `Assigned: ${assignedValue} · gene rows: ${sample.tpmRows.length} · ${(sample.runInfo.timings_ms.totalMs / 1000).toFixed(2)} sec`;
    const outputs = document.createElement('div');
    outputs.className = 'result-file-grid';
    outputs.append(...sample.outputs.map((output) => outputCard(output, result.outputSources.get(output.relative_path))));
    card.append(head, metrics, outputs);
    return card;
  }));
  elements.deleteCleanedFastq.hidden = result.retainedArtifacts.length === 0;
  elements.deleteCleanedFastq.disabled = false;
  elements.cleanupStatus.textContent = result.manifest.cleanup.message;
  elements.results.hidden = false;
  elements.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function releasePreviousRetained() {
  const entries = state.result?.retainedArtifacts?.filter((entryId) => !state.deletedEntries.has(entryId)) || [];
  if (entries.length) await deleteRetainedArtifacts(entries);
  for (const entryId of entries) state.deletedEntries.add(entryId);
}

async function runWorkflow() {
  if (state.running || !quickValidation().ok) return;
  const resource = await updateResourceEstimate();
  assertHisat2WebResources({ referenceBytes: state.reference.total_size, samples: selectedSamples(), runFastp: elements.runFastp.checked, availableBytes: resource.availableBytes });
  await releasePreviousRetained().catch((error) => { throw new Error(`Previous cleaned FASTQ cleanup failed: ${error.message || error}`); });
  state.running = true;
  state.cancelRequested = false;
  state.result = null;
  elements.results.hidden = true;
  elements.log.hidden = false;
  elements.log.textContent = '';
  elements.progress.hidden = false;
  elements.progress.className = 'progress-block is-running';
  elements.progressBar.style.width = '';
  elements.progressLabel.textContent = 'Starting local preflight…';
  elements.progressDetail.textContent = 'Working locally';
  elements.jobStatus.textContent = 'Running';
  elements.stageStatus.textContent = 'preflight';
  startTimer();
  const runner = new Hisat2WebRunner({ onEvent: onRunnerEvent });
  state.runner = runner;
  refresh();
  try {
    const result = await runner.run({
      reference: state.reference,
      samples: selectedSamples(),
      options: {
        threads: Number(elements.threads.value),
        runFastp: elements.runFastp.checked,
        fastpLengthRequired: Number(elements.fastpLength.value),
        strandedness: Number(elements.strandedness.value),
        featureType: elements.featureType.value.trim(),
        attribute: elements.attribute.value.trim(),
      },
    });
    stopTimer();
    elements.progress.className = 'progress-block is-complete';
    elements.progressBar.style.width = '100%';
    elements.progressLabel.textContent = 'Analysis complete; temporary SAM removed.';
    elements.progressDetail.textContent = `${result.samples.length} / ${result.samples.length} samples`;
    elements.jobStatus.textContent = 'Completed';
    elements.stageStatus.textContent = 'cleanup';
    renderResults(result);
  } catch (error) {
    stopTimer();
    elements.progress.className = 'progress-block is-error';
    elements.progressBar.style.width = '100%';
    const cancelled = error?.name === 'AbortError' || state.cancelRequested;
    elements.progressLabel.textContent = cancelled ? 'Analysis stopped; temporary artifacts cleaned.' : 'Analysis failed; temporary artifacts cleaned.';
    elements.progressDetail.textContent = error.manifest?.cleanup?.status ? `Cleanup: ${error.manifest.cleanup.status}` : 'See log for details';
    elements.jobStatus.textContent = cancelled ? 'Stopped' : 'Failed';
    elements.stageStatus.textContent = 'cleanup';
    elements.log.textContent += `${new Date().toISOString()} [${error.name || 'Error'}] ${error.message || error}\n`;
  } finally {
    state.runner = null;
    state.running = false;
    refresh();
  }
}

elements.addSample.addEventListener('click', addSample);
elements.run.addEventListener('click', () => runWorkflow().catch((error) => {
  elements.jobStatus.textContent = 'Failed';
  elements.log.hidden = false;
  elements.log.textContent += `${new Date().toISOString()} [Error] ${error.message || error}\n`;
}));
elements.cancel.addEventListener('click', () => {
  if (state.runner?.cancel()) {
    state.cancelRequested = true;
    elements.cancel.disabled = true;
    elements.progressLabel.textContent = 'Stopping active Worker and cleaning temporary artifacts…';
  }
});
elements.referenceSelect.addEventListener('change', () => showReference(state.references[Number(elements.referenceSelect.value)]));
elements.runFastp.addEventListener('change', refresh);
for (const input of document.querySelectorAll('input[name="w5ReadMode"], #w5Threads, #w5Strandedness, #w5FeatureType, #w5Attribute, #fastpLength')) {
  input.addEventListener('change', refresh);
  input.addEventListener('input', refresh);
}
elements.downloadManifest.addEventListener('click', () => {
  if (!state.result) return;
  downloadBlob(new Blob([`${JSON.stringify(state.result.manifest, null, 2)}\n`], { type: 'application/json' }), 'result_manifest.json');
});
elements.deleteCleanedFastq.addEventListener('click', async () => {
  if (!state.result) return;
  elements.deleteCleanedFastq.disabled = true;
  try {
    const remaining = state.result.retainedArtifacts.filter((entryId) => !state.deletedEntries.has(entryId));
    const removed = await deleteRetainedArtifacts(remaining);
    removed.forEach((entryId) => state.deletedEntries.add(entryId));
    renderResults(state.result, { preserveDeleted: true });
    elements.deleteCleanedFastq.hidden = true;
    elements.cleanupStatus.textContent = `Deleted ${removed.length} retained cleaned FASTQ artifact${removed.length === 1 ? '' : 's'} from OPFS.`;
  } catch (error) {
    elements.cleanupStatus.textContent = `Cleaned FASTQ cleanup failed: ${error.message || error}`;
    elements.deleteCleanedFastq.disabled = false;
  }
});

window.addEventListener('pagehide', () => {
  state.runner?.cancel();
  const retained = state.result?.retainedArtifacts?.filter((entryId) => !state.deletedEntries.has(entryId)) || [];
  if (retained.length) deleteRetainedArtifacts(retained).catch(() => {});
}, { once: true });

addSample();
try {
  const missing = [
    [crossOriginIsolated, 'cross-origin isolation'],
    [typeof SharedArrayBuffer !== 'undefined', 'SharedArrayBuffer'],
    [typeof Worker !== 'undefined', 'Worker'],
    [typeof navigator.storage?.getDirectory === 'function', 'OPFS'],
    [typeof crypto?.subtle?.digest === 'function', 'Web Crypto'],
    [typeof DecompressionStream === 'function', 'gzip streaming'],
  ].filter(([ok]) => !ok).map(([, label]) => label);
  if (missing.length) throw new Error(`Missing browser capabilities: ${missing.join(', ')}.`);
  const { config, catalog } = await loadConfiguredCatalog();
  state.references = catalog.references;
  for (const [index, reference] of state.references.entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = reference.display_name;
    elements.referenceSelect.append(option);
  }
  state.environmentReady = true;
  elements.environmentStatus.textContent = 'Wasm + OPFS + checksum support ready';
  elements.catalogBoundary.textContent = config.production_configured
    ? `Experimental W5 workflow. Production catalog configured with ${state.references.length} hosted reference package(s); W6 production-scale validation is still pending.`
    : `Experimental W5 workflow using a local synthetic test catalog only (${state.references.length} package). No production reference catalog is configured; do not use this fixture for biological interpretation.`;
  showReference(state.references[0]);
} catch (error) {
  elements.environmentStatus.textContent = 'Unavailable';
  elements.catalogBoundary.className = 'callout-error';
  elements.catalogBoundary.textContent = error.message || String(error);
  refresh();
}
