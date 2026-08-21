import { KallistoRunner } from './kallisto-client.js?v=20260821-w6-cross-browser';
import { MatrixBuilder } from './batch-results.mjs';
import { formatCapabilityBytes, inspectBrowserCapabilities } from './browser-capabilities.mjs?v=20260821-w6-cross-browser';
import { buildFastpArguments } from '../tools/fastp/runtime/fastp-runner.mjs';
import { safeSampleId } from '../tools/w5-pipeline/runtime/preflight.mjs';
import { KallistoFastpPreprocessor } from '../tools/w6-validation/runtime/kallisto-fastp.mjs';

const runner = new KallistoRunner();

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'progressStatus','localDataStatus','runtimeStatus','capabilityList','browserSupportStatus','capabilityStorage','hisat2Availability','buildReferencePanel','existingReferencePanel','indexSection',
  'transcriptomeFile','transcriptomeMeta','indexFile','indexMeta','kmerSize','indexThreads','makeUnique',
  'indexCommandPreview','buildIndexButton','downloadIndexButton','cancelIndexButton','indexProgress','indexProgressLabel','indexElapsed','indexLog',
  'sampleCards','addSampleButton',
  'runKallistoFastp','kallistoFastpThreadsField','kallistoFastpThreads','kallistoFastpLengthField','kallistoFastpLength',
  'quantThreads','bootstrapSamples','seed','strandedness','fragmentLengthField','fragmentSdField','singleOverhangField','fragmentLength','fragmentSd','singleOverhang',
  'quantCommandPreview','preflightMessage','runQuantButton','cancelQuantButton','quantProgress','quantProgressLabel','overallProgress','currentSample','batchProgressBar','batchStatusList','quantElapsed','quantLog',
  'resultsSection','summaryCards','matrixFiles','sampleResults','deleteKallistoFastp','kallistoFastpCleanupStatus','abundancePreview','analysisLog'
].map((id) => [id, $(id)]));

const state = {
  runtimeReady: false,
  generatedIndex: null,
  generatedIndexName: 'transcripts.idx',
  indexPerformance: null,
  indexLog: [],
  quantLog: [],
  samples: [],
  batchResults: [],
  matrixOutputs: [],
  fastpResults: [],
  retainedFastpEntries: [],
  preprocessor: null,
  running: null,
  cancelRequested: false,
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown size';
  const units = ['B','KB','MB','GB','TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 10 || unit === 0 ? 1 : 2)} ${units[unit]}`;
}

function selectedRadio(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
}

function fileList(input) {
  return Array.from(input.files || []);
}

function fileSummary(files, emptyText) {
  if (!files.length) return emptyText;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const names = files.length <= 3 ? files.map((file) => file.name).join(', ') : `${files.slice(0, 3).map((file) => file.name).join(', ')} +${files.length - 3} more`;
  return `${files.length} file${files.length === 1 ? '' : 's'} (${formatBytes(total)}): ${names}`;
}

function setMeta(element, text, status = '') {
  element.textContent = text;
  element.classList.remove('is-ready', 'is-error');
  if (status) element.classList.add(status);
}

function shellQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:+\-=]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function currentReference() {
  const mode = selectedRadio('referenceMode');
  if (mode === 'build') {
    if (!state.generatedIndex) return null;
    return { name: state.generatedIndexName, blob: state.generatedIndex, source: 'generated' };
  }
  const file = els.indexFile.files?.[0];
  return file ? { name: file.name, blob: file, source: 'selected' } : null;
}

function makeFilePicker(labelText, multiple = true) {
  const card = document.createElement('div');
  card.className = 'file-picker-card';
  const label = document.createElement('label');
  const span = document.createElement('span');
  span.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = multiple;
  input.accept = '.fastq,.fq,.fastq.gz,.fq.gz,.gz,text/plain,application/gzip';
  const meta = document.createElement('p');
  meta.className = 'file-meta';
  label.append(span, input);
  card.append(label, meta);
  return { card, input, meta };
}

function refreshSampleNumbers() {
  state.samples.forEach((sample, index) => {
    sample.title.textContent = `Sample ${index + 1}`;
    sample.removeButton.disabled = Boolean(state.running) || state.samples.length === 1;
  });
}

function addSample() {
  const existingNames = new Set(state.samples.map((sample) => sample.nameInput.value.trim()));
  let sampleNumber = 1;
  while (existingNames.has(`sample${sampleNumber}`)) sampleNumber += 1;
  const card = document.createElement('article');
  card.className = 'sample-card';
  const head = document.createElement('div');
  head.className = 'sample-card-head';
  const title = document.createElement('h3');
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'remove-sample-button';
  removeButton.textContent = 'Remove sample';
  head.append(title, removeButton);

  const nameLabel = document.createElement('label');
  nameLabel.className = 'sample-name-field';
  const nameSpan = document.createElement('span');
  nameSpan.textContent = 'Sample name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = `sample${sampleNumber}`;
  nameInput.autocomplete = 'off';
  nameLabel.append(nameSpan, nameInput);

  const pairedPanel = document.createElement('div');
  pairedPanel.className = 'sample-read-grid';
  const r1 = makeFilePicker('Read 1 (R1) FASTQ / FASTQ.gz');
  const r2 = makeFilePicker('Read 2 (R2) FASTQ / FASTQ.gz');
  pairedPanel.append(r1.card, r2.card);

  const singlePanel = document.createElement('div');
  singlePanel.className = 'sample-read-grid';
  const single = makeFilePicker('Single-end FASTQ / FASTQ.gz');
  singlePanel.append(single.card);
  card.append(head, nameLabel, pairedPanel, singlePanel);

  const sample = {
    card, title, removeButton, nameInput, pairedPanel, singlePanel,
    r1Input: r1.input, r1Meta: r1.meta,
    r2Input: r2.input, r2Meta: r2.meta,
    singleInput: single.input, singleMeta: single.meta,
  };
  state.samples.push(sample);
  els.sampleCards.appendChild(card);
  for (const input of [nameInput, r1.input, r2.input, single.input]) {
    input.addEventListener('change', updateControls);
    input.addEventListener('input', updateControls);
  }
  removeButton.addEventListener('click', () => {
    if (state.running || state.samples.length <= 1) return;
    const index = state.samples.indexOf(sample);
    if (index >= 0) state.samples.splice(index, 1);
    card.remove();
    refreshSampleNumbers();
    updateControls();
  });
  refreshSampleNumbers();
  updateControls();
}

function getReadSamples() {
  const mode = selectedRadio('readMode');
  return state.samples.map((sample) => {
    const name = sample.nameInput.value.trim();
    if (mode === 'paired') {
      const r1 = fileList(sample.r1Input);
      const r2 = fileList(sample.r2Input);
      return { name, mode, r1, r2, valid: r1.length > 0 && r1.length === r2.length, ui: sample };
    }
    const single = fileList(sample.singleInput);
    return { name, mode, single, valid: single.length > 0, ui: sample };
  });
}

function buildIndexArgs() {
  const fasta = els.transcriptomeFile.files?.[0];
  if (!fasta) return [];
  const args = ['index', '-i', '/output/transcripts.idx', '-k', String(els.kmerSize.value || 31), '-t', String(els.indexThreads.value || 1)];
  if (els.makeUnique.checked) args.push('--make-unique');
  args.push(`/input/${fasta.name.replace(/[\\/]/g, '_').replace(/[^A-Za-z0-9._+\-]/g, '_')}`);
  return args;
}

function buildQuantArgs(reads = getReadSamples()[0], sampleIndex = 0) {
  const outputDir = `/output/sample_${sampleIndex + 1}`;
  const args = [
    'quant', '-i', '/reference/reference.idx', '-o', outputDir, '--plaintext',
    '-t', String(els.quantThreads.value || 1),
    '-b', String(els.bootstrapSamples.value || 0),
    '--seed', String(els.seed.value || 42),
  ];

  if (els.strandedness.value === 'fr') args.push('--fr-stranded');
  if (els.strandedness.value === 'rf') args.push('--rf-stranded');

  if (reads.mode === 'single') {
    args.push('--single', '-l', String(els.fragmentLength.value || 200), '-s', String(els.fragmentSd.value || 20));
    if (els.singleOverhang.checked) args.push('--single-overhang');
    reads.single.forEach((file, i) => args.push(`/reads/read_${i + 1}_${sanitizeName(file.name)}`));
  } else {
    reads.r1.forEach((file, i) => {
      args.push(`/reads/R1_${i + 1}_${sanitizeName(file.name)}`);
      args.push(`/reads/R2_${i + 1}_${sanitizeName(reads.r2[i]?.name || `read2_${i + 1}.fastq`)}`);
    });
  }
  return args;
}

function sanitizeName(name) {
  return String(name).replace(/[\\/]/g, '_').replace(/[^A-Za-z0-9._+\-]/g, '_');
}

function updatePreviews() {
  const indexArgs = buildIndexArgs();
  els.indexCommandPreview.textContent = indexArgs.length ? `kallisto ${indexArgs.map(shellQuote).join(' ')}` : 'kallisto index -i transcripts.idx transcripts.fasta.gz';
  const quantArgs = buildQuantArgs();
  const lines = [];
  if (els.runKallistoFastp.checked) {
    const first = getReadSamples()[0] || { name: 'sample1', mode: selectedRadio('readMode') || 'paired', r1: [], r2: [], single: [] };
    const mode = first.mode === 'single' ? 'se' : 'pe';
    const firstFile = mode === 'se' ? first.single?.[0] : first.r1?.[0];
    const suffix = `.fastq${/\.gz$/i.test(firstFile?.name || '') ? '.gz' : ''}`;
    const sampleId = safeSampleId(first.name || 'sample1', 0);
    const dummy = new Blob(['x']);
    const fastpArgs = buildFastpArguments({
      mode,
      inputs: { read1: dummy, ...(mode === 'pe' ? { read2: dummy } : {}) },
      options: {
        threads: Number(els.kallistoFastpThreads.value || 1),
        lengthRequired: Number(els.kallistoFastpLength.value || 15),
        compression: 4,
        reportTitle: `${first.name || 'sample1'} fastp preprocessing for kallisto`,
      },
    }, {
      read1: `/input/${sampleId}-read1${suffix}`,
      read2: mode === 'pe' ? `/input/${sampleId}-read2${suffix}` : null,
    });
    lines.push(`fastp ${fastpArgs.map(shellQuote).join(' ')}`);
  } else {
    lines.push('fastp OFF — established Kallisto input path');
  }
  lines.push(`kallisto ${quantArgs.map(shellQuote).join(' ')}`);
  els.quantCommandPreview.textContent = lines.join('\n');
}

function updateReadPanels() {
  const single = selectedRadio('readMode') === 'single';
  for (const sample of state.samples) {
    sample.pairedPanel.hidden = single;
    sample.singlePanel.hidden = !single;
  }
  els.fragmentLengthField.hidden = !single;
  els.fragmentSdField.hidden = !single;
  els.singleOverhangField.hidden = !single;
  els.kallistoFastpThreadsField.hidden = !els.runKallistoFastp.checked;
  els.kallistoFastpLengthField.hidden = !els.runKallistoFastp.checked;
}

function updateReferencePanels() {
  const build = selectedRadio('referenceMode') === 'build';
  els.buildReferencePanel.hidden = !build;
  els.existingReferencePanel.hidden = build;
  els.indexSection.hidden = !build;
}

function updateFileMeta() {
  const fasta = els.transcriptomeFile.files?.[0];
  setMeta(els.transcriptomeMeta, fasta ? `${fasta.name} (${formatBytes(fasta.size)})` : 'No transcriptome selected.', fasta ? 'is-ready' : '');
  const idx = els.indexFile.files?.[0];
  setMeta(els.indexMeta, idx ? `${idx.name} (${formatBytes(idx.size)})` : 'No index selected.', idx ? 'is-ready' : '');
  for (const sample of state.samples) {
    const r1 = fileList(sample.r1Input);
    const r2 = fileList(sample.r2Input);
    const single = fileList(sample.singleInput);
    setMeta(sample.r1Meta, fileSummary(r1, 'No Read 1 file selected.'), r1.length ? 'is-ready' : '');
    setMeta(sample.r2Meta, fileSummary(r2, 'No Read 2 file selected.'), r2.length ? 'is-ready' : '');
    setMeta(sample.singleMeta, fileSummary(single, 'No FASTQ file selected.'), single.length ? 'is-ready' : '');
    if (r1.length && r2.length && r1.length !== r2.length) {
      setMeta(sample.r2Meta, `${fileSummary(r2, '')} — number of R2 files must match R1.`, 'is-error');
    }
  }
}

function updateLocalStatus() {
  const ref = currentReference();
  const samples = getReadSamples();
  const pieces = [];
  if (ref) pieces.push(`Reference ready (${formatBytes(ref.blob.size)})`);
  const ready = samples.filter((sample) => sample.valid).length;
  if (ready) pieces.push(`${ready} / ${samples.length} sample${samples.length === 1 ? '' : 's'} ready`);
  els.localDataStatus.textContent = pieces.length ? pieces.join(' | ') : 'No usable reference/read combination yet';
}

function validateIndex() {
  const fasta = els.transcriptomeFile.files?.[0];
  const k = Number(els.kmerSize.value);
  const threads = Number(els.indexThreads.value);
  return Boolean(state.runtimeReady && fasta && Number.isInteger(k) && k >= 1 && k <= 31 && k % 2 === 1 && Number.isInteger(threads) && threads >= 1 && threads <= 8);
}

async function readFastqPrefix(file, maxChars = 262144) {
  if (!file || file.size === 0) throw new Error(`FASTQ file is empty: ${file?.name || 'unknown file'}`);

  const isGzip = /\.gz$/i.test(file.name || '');
  if (!isGzip) return file.slice(0, maxChars).text();

  // Best-effort validation for gzip FASTQ in modern Chromium/Firefox.
  // If browser-side gzip inspection is unavailable, kallisto remains the parser of record.
  if (typeof DecompressionStream === 'undefined') return null;

  try {
    const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (text.length < maxChars) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      // 16 lines = four FASTQ records; enough for a structural preflight.
      if ((text.match(/\n/g) || []).length >= 16) break;
    }
    try { await reader.cancel(); } catch (_) {}
    return text;
  } catch (_) {
    return null;
  }
}

async function validateFastqFile(file, label) {
  const prefix = await readFastqPrefix(file);
  if (prefix == null) return; // gzip preflight unavailable; kallisto will validate it.

  const lines = prefix.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  // Ignore an incomplete final line caused by prefix slicing.
  if (lines.length && lines[lines.length - 1] !== '') lines.pop();
  const completeRecords = Math.min(4, Math.floor(lines.length / 4));
  if (completeRecords < 1) {
    throw new Error(`${label}: ${file.name} does not contain a complete FASTQ record.`);
  }

  for (let record = 0; record < completeRecords; record += 1) {
    const i = record * 4;
    const header = lines[i] || '';
    const sequence = lines[i + 1] || '';
    const plus = lines[i + 2] || '';
    const quality = lines[i + 3] || '';
    if (!header.startsWith('@')) {
      throw new Error(`${label}: ${file.name}, record ${record + 1}: FASTQ header must start with @.`);
    }
    if (!plus.startsWith('+')) {
      throw new Error(`${label}: ${file.name}, record ${record + 1}: FASTQ third line must start with +.`);
    }
    if (!sequence.length) {
      throw new Error(`${label}: ${file.name}, record ${record + 1}: sequence is empty.`);
    }
    if (sequence.length !== quality.length) {
      throw new Error(
        `${label}: ${file.name}, record ${record + 1}: sequence length (${sequence.length}) ` +
        `does not match quality length (${quality.length}). The FASTQ file is malformed.`
      );
    }
  }
}

async function preflightFastqFiles(samples = getReadSamples()) {
  for (const sample of samples) {
    if (sample.mode === 'single') {
      for (let i = 0; i < sample.single.length; i += 1) {
        await validateFastqFile(sample.single[i], `${sample.name}, Read ${i + 1}`);
      }
      continue;
    }
    for (let i = 0; i < sample.r1.length; i += 1) {
      await validateFastqFile(sample.r1[i], `${sample.name}, R1 pair ${i + 1}`);
      await validateFastqFile(sample.r2[i], `${sample.name}, R2 pair ${i + 1}`);
    }
  }
}

function validateQuant() {
  const ref = currentReference();
  const samples = getReadSamples();
  const threads = Number(els.quantThreads.value);
  if (!state.runtimeReady) return { ok: false, message: 'kallisto WebAssembly runtime is not installed or not reachable.' };
  if (!ref) return { ok: false, message: selectedRadio('referenceMode') === 'build' ? 'Build the kallisto index first.' : 'Select an existing kallisto index.' };
  if (!samples.length) return { ok: false, message: 'Add at least one sample.' };
  const names = new Set();
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    if (!sample.name) return { ok: false, message: `Sample ${i + 1} name must not be empty.` };
    if (/\t|\r|\n/.test(sample.name)) return { ok: false, message: `${sample.name || `Sample ${i + 1}`}: tabs and newlines are not allowed in sample names.` };
    if (names.has(sample.name)) return { ok: false, message: `Duplicate sample name: ${sample.name}.` };
    names.add(sample.name);
    if (!sample.valid) {
      return { ok: false, message: sample.mode === 'paired'
        ? `${sample.name}: select matching R1 and R2 FASTQ files.`
        : `${sample.name}: select at least one single-end FASTQ file.` };
    }
  }
  if (!Number.isInteger(threads) || threads < 1 || threads > 8) return { ok: false, message: 'Threads must be an integer from 1 to 8 in the v10 build.' };
  if (els.runKallistoFastp.checked) {
    const fastpThreads = Number(els.kallistoFastpThreads.value);
    const minimumLength = Number(els.kallistoFastpLength.value);
    if (!Number.isInteger(fastpThreads) || fastpThreads < 1 || fastpThreads > 4) return { ok: false, message: 'fastp threads must be an integer from 1 to 4.' };
    if (!Number.isInteger(minimumLength) || minimumLength < 1 || minimumLength > 100000) return { ok: false, message: 'fastp minimum read length must be from 1 to 100000.' };
  }
  if (samples[0].mode === 'single') {
    if (!(Number(els.fragmentLength.value) > 0) || !(Number(els.fragmentSd.value) > 0)) return { ok: false, message: 'Single-end mode requires positive fragment length and SD values.' };
  }
  return { ok: true, message: `Ready. ${samples.length} sample${samples.length === 1 ? '' : 's'} will run sequentially.` };
}

function updateControls() {
  updateReferencePanels();
  updateReadPanels();
  updateFileMeta();
  updatePreviews();
  updateLocalStatus();

  els.buildIndexButton.disabled = !validateIndex() || Boolean(state.running);
  els.downloadIndexButton.disabled = !state.generatedIndex || Boolean(state.running);
  els.addSampleButton.disabled = Boolean(state.running);
  refreshSampleNumbers();

  const quant = validateQuant();
  els.runQuantButton.disabled = !quant.ok || Boolean(state.running);
  els.preflightMessage.textContent = quant.message;
  els.preflightMessage.className = quant.ok ? 'callout-success' : 'callout-warning';
}

function startTimer(element) {
  const started = performance.now();
  element.textContent = '0 sec';
  const id = window.setInterval(() => {
    const seconds = Math.round((performance.now() - started) / 1000);
    element.textContent = `${seconds} sec`;
  }, 500);
  return { started, stop: () => { clearInterval(id); const seconds = Math.round((performance.now() - started) / 1000); element.textContent = `${seconds} sec`; return seconds; } };
}

function appendLog(target, lines, prefix = '') {
  target.hidden = false;
  for (const line of lines) {
    target.textContent += `${prefix}${line}\n`;
  }
  target.scrollTop = target.scrollHeight;
}

function resetProgress(element, label, text) {
  element.hidden = false;
  element.classList.remove('is-complete','is-error');
  element.classList.add('is-running');
  label.textContent = text;
}

function finishProgress(element, label, text, error = false) {
  element.classList.remove('is-running');
  element.classList.add(error ? 'is-error' : 'is-complete');
  label.textContent = text;
}

function blobFromOutput(output, type = 'application/octet-stream') {
  if (output?.blob instanceof Blob) return output.blob;
  return new Blob([output.buffer], { type });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function outputByName(name, sampleResult = state.batchResults[0]) {
  return sampleResult?.outputs.find((file) => file.name === name);
}

function parseJsonOutput(name, sampleResult = state.batchResults[0]) {
  const output = outputByName(name, sampleResult);
  if (!output) return null;
  try { return JSON.parse(new TextDecoder().decode(output.buffer)); } catch (_) { return null; }
}

function sanitizeDownloadName(name, fallback = 'sample') {
  let cleaned = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  if (!cleaned || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(cleaned)) cleaned = `_${cleaned || fallback}`;
  return cleaned;
}

function renderAbundancePreview() {
  const output = outputByName('abundance.tsv');
  if (!output) {
    els.abundancePreview.innerHTML = '<p class="muted">No abundance.tsv output.</p>';
    return;
  }
  const text = new TextDecoder().decode(output.buffer);
  const rows = text.trim().split(/\r?\n/).slice(0, 21).map((line) => line.split('\t'));
  if (!rows.length) return;
  const [header, ...body] = rows;
  const table = document.createElement('table');
  table.className = 'preview-table';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  header.forEach((value) => { const th = document.createElement('th'); th.textContent = value; trh.appendChild(th); });
  thead.appendChild(trh); table.appendChild(thead);
  const tbody = document.createElement('tbody');
  body.forEach((row) => {
    const tr = document.createElement('tr');
    row.forEach((value) => { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const viewport = document.createElement('div');
  viewport.className = 'table-viewport'; viewport.appendChild(table);
  els.abundancePreview.replaceChildren(viewport);
  if (text.trim().split(/\r?\n/).length > 21) {
    const note = document.createElement('p'); note.className = 'small-note'; note.textContent = 'Showing the first 20 transcripts. Download abundance.tsv for the complete table.'; els.abundancePreview.appendChild(note);
  }
}

function renderResults(runtimeSeconds) {
  els.resultsSection.hidden = false;
  const runInfos = state.batchResults.map((sample) => parseJsonOutput('run_info.json', sample));
  const perfReports = state.batchResults.map((sample) => parseJsonOutput('browser_performance.json', sample));
  const processed = runInfos.reduce((sum, info) => sum + (Number(info?.n_processed) || 0), 0);
  const pseudoaligned = runInfos.reduce((sum, info) => sum + (Number(info?.n_pseudoaligned) || 0), 0);
  const pseudoSec = perfReports.reduce((sum, perf) => sum + (Number(perf?.fastq_processing_pseudoalignment_sec) || 0), 0);
  const throughput = pseudoSec > 0 ? `${Math.round(processed / pseudoSec).toLocaleString()} reads/s` : 'See performance files';
  const peakLinearMemory = Math.max(0, ...perfReports.map((perf) => Number(perf?.wasm_peak_linear_memory_bytes) || 0));
  const cards = [
    ['Batch runtime', `${runtimeSeconds} sec`],
    ['Samples completed', String(state.batchResults.length)],
    ['Combined pseudoalign speed', throughput],
    ['Processed reads', processed.toLocaleString()],
    ['Pseudoaligned', pseudoaligned.toLocaleString()],
    ['Wasm linear-memory high water', peakLinearMemory > 0 ? formatBytes(peakLinearMemory) : 'Not measured'],
  ];
  els.summaryCards.replaceChildren(...cards.map(([label, value]) => {
    const div = document.createElement('div'); div.className = 'summary-card';
    const strong = document.createElement('strong'); strong.textContent = value;
    const span = document.createElement('span'); span.textContent = label;
    div.append(strong, span); return div;
  }));

  els.matrixFiles.replaceChildren(...state.matrixOutputs.map((output) => {
    const card = document.createElement('div'); card.className = 'result-file-card';
    const h = document.createElement('h4'); h.textContent = output.name;
    const p = document.createElement('p'); p.textContent = formatBytes(output.blob.size);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'download-button'; b.textContent = `Download ${output.name}`;
    b.addEventListener('click', () => downloadBlob(output.blob, output.name));
    card.append(h,p,b); return card;
  }));

  els.sampleResults.replaceChildren(...state.batchResults.map((sample) => {
    const card = document.createElement('article');
    card.className = 'sample-result-card';
    const head = document.createElement('div');
    head.className = 'sample-result-head';
    const h = document.createElement('h4'); h.textContent = sample.name;
    const status = document.createElement('strong'); status.className = 'status-completed'; status.textContent = '✓ Completed';
    head.append(h, status);
    const downloads = document.createElement('div'); downloads.className = 'sample-result-downloads';
    for (const output of sample.outputs) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'download-button'; button.textContent = `Download ${output.name}`;
      const mime = output.name.endsWith('.json') ? 'application/json' : 'text/tab-separated-values';
      button.addEventListener('click', () => downloadBlob(
        blobFromOutput(output, mime),
        `${sanitizeDownloadName(sample.name)}_${sanitizeDownloadName(output.name, 'output')}`
      ));
      downloads.appendChild(button);
    }
    card.append(head, downloads);
    return card;
  }));
  els.deleteKallistoFastp.hidden = state.retainedFastpEntries.length === 0;
  els.deleteKallistoFastp.disabled = false;
  els.kallistoFastpCleanupStatus.textContent = state.retainedFastpEntries.length
    ? `${state.retainedFastpEntries.length} cleaned FASTQ artifact${state.retainedFastpEntries.length === 1 ? '' : 's'} retained in browser storage for download.`
    : '';
  renderAbundancePreview();
  els.analysisLog.textContent = state.quantLog.join('\n');
  els.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function buildIndex() {
  const fasta = els.transcriptomeFile.files?.[0];
  if (!fasta || !validateIndex()) return;
  state.running = 'index';
  state.indexLog = [];
  els.indexLog.textContent = '';
  els.progressStatus.textContent = 'Building kallisto index';
  resetProgress(els.indexProgress, els.indexProgressLabel, 'Building kallisto index locally...');
  const timer = startTimer(els.indexElapsed);
  els.cancelIndexButton.disabled = false;
  updateControls();

  const mountedName = sanitizeName(fasta.name);
  const args = buildIndexArgs();
  args[args.length - 1] = `/input/${mountedName}`;

  try {
    const result = await runner.run({
      args,
      inputs: [{ name: mountedName, blob: fasta }],
      outputPaths: ['/output/transcripts.idx'],
    }, (event) => {
      if (event.type === 'stdout') { state.indexLog.push(event.line); appendLog(els.indexLog, [event.line]); }
      if (event.type === 'stderr') { state.indexLog.push(event.line); appendLog(els.indexLog, [event.line], '[stderr] '); }
      if (event.type === 'status') els.indexProgressLabel.textContent = event.message;
    });
    const indexOutput = result.outputs.find((file) => file.name === 'transcripts.idx');
    if (!indexOutput) throw new Error('kallisto did not produce transcripts.idx.');
    const performanceOutput = result.outputs.find((file) => file.name === 'browser_performance.json');
    state.indexPerformance = performanceOutput
      ? JSON.parse(new TextDecoder().decode(performanceOutput.buffer))
      : null;
    state.generatedIndex = blobFromOutput(indexOutput);
    state.generatedIndexName = `${fasta.name.replace(/\.(fa|fasta|fna)(\.gz)?$/i, '') || 'transcripts'}.idx`;
    timer.stop();
    const peakMemory = Number(state.indexPerformance?.wasm_peak_linear_memory_bytes);
    const memoryLabel = Number.isFinite(peakMemory) ? ` · Wasm high water ${formatBytes(peakMemory)}` : '';
    finishProgress(els.indexProgress, els.indexProgressLabel, `Index ready (${formatBytes(state.generatedIndex.size)}${memoryLabel})`);
    els.progressStatus.textContent = 'Index ready';
    appendLog(els.indexLog, [`Generated ${state.generatedIndexName} (${formatBytes(state.generatedIndex.size)})`], '[web] ');
    if (Number.isFinite(peakMemory)) appendLog(els.indexLog, [`Wasm linear-memory high water: ${peakMemory} bytes (${formatBytes(peakMemory)})`], '[web] ');
  } catch (error) {
    timer.stop();
    finishProgress(els.indexProgress, els.indexProgressLabel, 'Index build failed', true);
    els.progressStatus.textContent = 'Index build failed';
    appendLog(els.indexLog, [error.message || String(error)], '[error] ');
  } finally {
    state.running = null;
    els.cancelIndexButton.disabled = true;
    updateControls();
  }
}

function buildQuantInputs(reads) {
  const inputs = [];
  if (reads.mode === 'single') {
    reads.single.forEach((file, i) => inputs.push({ name: `read_${i + 1}_${sanitizeName(file.name)}`, blob: file }));
  } else {
    reads.r1.forEach((file, i) => {
      inputs.push({ name: `R1_${i + 1}_${sanitizeName(file.name)}`, blob: file });
      inputs.push({ name: `R2_${i + 1}_${sanitizeName(reads.r2[i].name)}`, blob: reads.r2[i] });
    });
  }
  return inputs;
}

function renderBatchProgress(samples, statuses, completed, currentName = '—') {
  els.overallProgress.textContent = `Overall progress: ${completed} / ${samples.length}`;
  els.currentSample.textContent = `Current sample: ${currentName}`;
  els.batchProgressBar.style.width = `${samples.length ? (completed / samples.length) * 100 : 0}%`;
  els.batchStatusList.replaceChildren(...samples.map((sample, index) => {
    const row = document.createElement('div'); row.className = 'batch-status-row';
    const name = document.createElement('strong'); name.textContent = sample.name;
    const value = document.createElement('span');
    const status = statuses[index] || 'Waiting';
    value.textContent = status === 'Completed' ? '✓ Completed' : status;
    if (status === 'Completed') value.className = 'status-completed';
    else if (status === 'Failed') value.className = 'status-failed';
    else if (status !== 'Waiting') value.className = 'status-running';
    row.append(name, value); return row;
  }));
}

async function cleanupKallistoFastp() {
  if (!state.retainedFastpEntries.length) return [];
  const cleaner = state.preprocessor || new KallistoFastpPreprocessor();
  const targets = [...state.retainedFastpEntries];
  const removed = await cleaner.cleanup(targets);
  state.retainedFastpEntries = state.retainedFastpEntries.filter((entryId) => !removed.includes(entryId));
  if (!state.retainedFastpEntries.length) {
    for (const sample of state.batchResults) sample.outputs = sample.outputs.filter((output) => !output.fastpEntryId);
  }
  return removed;
}

async function runQuant() {
  const validation = validateQuant();
  if (!validation.ok) return;
  const reference = currentReference();
  state.running = 'quant';
  state.cancelRequested = false;
  state.quantLog = [];
  state.batchResults = [];
  state.matrixOutputs = [];
  state.fastpResults = [];
  els.quantLog.textContent = '';
  els.resultsSection.hidden = true;
  els.progressStatus.textContent = 'Running kallisto quant';
  resetProgress(els.quantProgress, els.quantProgressLabel, 'Running kallisto quant locally...');
  const timer = startTimer(els.quantElapsed);
  els.cancelQuantButton.disabled = false;
  const samples = getReadSamples();
  let quantSamples = samples;
  const statuses = samples.map(() => 'Waiting');
  let completed = 0;
  let matrixBuilder = new MatrixBuilder();
  renderBatchProgress(samples, statuses, completed);
  updateControls();

  try {
    await cleanupKallistoFastp();
    els.quantProgressLabel.textContent = 'Checking FASTQ structure locally...';
    await preflightFastqFiles(samples);
    if (els.runKallistoFastp.checked) {
      statuses.fill('Waiting for fastp');
      renderBatchProgress(samples, statuses, completed);
      els.quantProgressLabel.textContent = 'Running optional fastp preprocessing locally...';
      const preprocessor = new KallistoFastpPreprocessor({ onEvent(event) {
        const samplePrefix = event.sample ? `[${event.sample}] ` : '';
        const logLine = `[fastp] ${event.message}`;
        state.quantLog.push(`${samplePrefix}${logLine}`);
        appendLog(els.quantLog, [logLine], samplePrefix);
        if (event.type === 'progress' && event.sample) {
          const index = samples.findIndex((sample) => sample.name === event.sample);
          if (index >= 0) statuses[index] = /completed/.test(event.message) ? 'fastp completed' : 'Running fastp';
          renderBatchProgress(samples, statuses, completed, event.sample);
        }
      } });
      state.preprocessor = preprocessor;
      const fastpBatch = await preprocessor.run(samples, {
        threads: Number(els.kallistoFastpThreads.value),
        lengthRequired: Number(els.kallistoFastpLength.value),
      });
      state.fastpResults = fastpBatch.samples;
      state.retainedFastpEntries = fastpBatch.retainedEntries;
      quantSamples = fastpBatch.samples.map((sample) => sample.processed);
      statuses.fill('Waiting for Kallisto');
      renderBatchProgress(samples, statuses, completed);
    }
    els.quantProgressLabel.textContent = 'Running batch quantification locally...';
    await runner.runBatch({
      reference: { name: 'reference.idx', blob: reference.blob },
      samples: quantSamples.map((sample, index) => {
        const outputDir = `/output/sample_${index + 1}`;
        return {
          name: sample.name,
          args: buildQuantArgs(sample, index),
          inputs: buildQuantInputs(sample),
          outputDir,
          outputPaths: [`${outputDir}/abundance.tsv`, `${outputDir}/run_info.json`],
        };
      }),
    }, (event) => {
      const samplePrefix = event.sample ? `[${event.sample}] ` : '';
      if (event.type === 'stdout') { state.quantLog.push(`${samplePrefix}${event.line}`); appendLog(els.quantLog, [event.line], samplePrefix); }
      if (event.type === 'stderr') { state.quantLog.push(`${samplePrefix}[stderr] ${event.line}`); appendLog(els.quantLog, [event.line], `${samplePrefix}[stderr] `); }
      if (event.type === 'status') {
        els.quantProgressLabel.textContent = event.message;
        if (Number.isInteger(event.sampleIndex) && event.stage) {
          statuses[event.sampleIndex] = event.stage;
          renderBatchProgress(samples, statuses, completed, samples[event.sampleIndex].name);
        }
      }
      if (event.type === 'sample-result') {
        const sampleResult = { name: samples[event.sampleIndex].name, outputs: event.result.outputs };
        const abundance = outputByName('abundance.tsv', sampleResult);
        if (!abundance) throw new Error(`${sampleResult.name}: abundance.tsv was not returned.`);
        try {
          matrixBuilder.addSample(sampleResult.name, abundance.buffer);
        } catch (error) {
          throw new Error(`Failed sample: ${sampleResult.name}\n${error?.message || String(error)}`);
        }
        state.batchResults[event.sampleIndex] = sampleResult;
        statuses[event.sampleIndex] = 'Completed';
        completed += 1;
        renderBatchProgress(samples, statuses, completed, sampleResult.name);
      }
    });
    state.batchResults = state.batchResults.filter(Boolean);
    for (const sample of state.batchResults) {
      const fastp = state.fastpResults.find((candidate) => candidate.name === sample.name);
      if (!fastp) continue;
      sample.outputs.push(...fastp.reports.map((report) => ({ name: `fastp/${report.name}`, blob: report.blob })));
      sample.outputs.push({
        name: 'fastp/fastp_qc_summary.json',
        blob: new Blob([`${JSON.stringify({ schema_version: 1, args: fastp.args, qc: fastp.qc, elapsed_ms: fastp.elapsedMs }, null, 2)}\n`], { type: 'application/json' }),
      });
      sample.outputs.push(...fastp.cleaned.map((output) => ({ name: `fastp/${output.name}`, blob: output.file, fastpEntryId: output.entryId })));
    }
    const matrices = matrixBuilder.toMatrices();
    state.matrixOutputs = [
      { name: 'counts_matrix.tsv', blob: new Blob([matrices.counts], { type: 'text/tab-separated-values' }) },
      { name: 'tpm_matrix.tsv', blob: new Blob([matrices.tpm], { type: 'text/tab-separated-values' }) },
    ];
    matrixBuilder.release();
    matrixBuilder = null;
    const seconds = timer.stop();
    renderBatchProgress(samples, statuses, completed);
    finishProgress(els.quantProgress, els.quantProgressLabel, 'Batch quantification complete');
    els.progressStatus.textContent = 'Batch quantification complete';
    const quantPeakLinearMemory = Math.max(0, ...state.batchResults.map((sample) => Number(parseJsonOutput('browser_performance.json', sample)?.wasm_peak_linear_memory_bytes) || 0));
    if (quantPeakLinearMemory > 0) {
      const memoryLine = `Wasm linear-memory high water: ${quantPeakLinearMemory} bytes (${formatBytes(quantPeakLinearMemory)})`;
      state.quantLog.push(`[web] ${memoryLine}`);
      appendLog(els.quantLog, [memoryLine], '[web] ');
    }
    renderResults(seconds);
  } catch (error) {
    if (state.cancelRequested) {
      if (matrixBuilder) matrixBuilder.release();
      matrixBuilder = null;
      timer.stop();
      finishProgress(els.quantProgress, els.quantProgressLabel, 'Quantification stopped', true);
      els.progressStatus.textContent = 'Stopped';
      return;
    }
    const failedName = String(error?.message || error).match(/Failed sample:\s*([^\n]+)/)?.[1];
    if (failedName) {
      const failedIndex = samples.findIndex((sample) => sample.name === failedName);
      if (failedIndex >= 0) statuses[failedIndex] = 'Failed';
    }
    renderBatchProgress(samples, statuses, completed, failedName || '—');
    if (matrixBuilder) matrixBuilder.release();
    matrixBuilder = null;
    timer.stop();
    finishProgress(els.quantProgress, els.quantProgressLabel, failedName ? `Failed sample: ${failedName}` : 'Quantification failed', true);
    els.progressStatus.textContent = failedName ? `Failed sample: ${failedName}` : 'Quantification failed';
    appendLog(els.quantLog, [error.message || String(error)], '[error] ');
  } finally {
    if (els.progressStatus.textContent !== 'Batch quantification complete') {
      await cleanupKallistoFastp().catch((cleanupError) => appendLog(els.quantLog, [cleanupError.message || String(cleanupError)], '[cleanup error] '));
    }
    state.preprocessor = null;
    state.running = null;
    els.cancelQuantButton.disabled = true;
    updateControls();
  }
}

async function initRuntime() {
  const result = await runner.checkRuntime();
  const isolationReady = window.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
  state.runtimeReady = Boolean(result.ready && isolationReady);
  if (state.runtimeReady) {
    els.runtimeStatus.textContent = 'kallisto v10 WASM64 ready | SIMD128 + LTO + zlib-ng | pthread enabled';
  } else if (result.ready && !isolationReady) {
    els.runtimeStatus.textContent = 'WASM found, but cross-origin isolation is missing (COOP/COEP required)';
  } else {
    els.runtimeStatus.textContent = result.error ? `WASM64 runtime unavailable: ${result.error}` : 'WASM runtime not built yet — see README/build-wasm.sh';
  }

  const capabilities = await inspectBrowserCapabilities(window, {
    kallistoRuntimeReady: state.runtimeReady,
    hisat2EngineAvailable: true,
  });
  els.capabilityList.replaceChildren(...capabilities.checks.map((check) => {
    const item = document.createElement('li');
    item.className = check.ok ? 'capability-ok' : 'capability-missing';
    const marker = document.createElement('span');
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = check.ok ? '✓' : '—';
    const label = document.createElement('span');
    label.textContent = check.label;
    item.append(marker, label);
    return item;
  }));

  const { quota_bytes: quota, usage_bytes: usage, available_bytes: available } = capabilities.storage;
  els.browserSupportStatus.textContent = capabilities.browser_support.message;
  els.capabilityStorage.textContent = Number.isFinite(available)
    ? `${formatCapabilityBytes(available)} available of ${formatCapabilityBytes(quota)} (${formatCapabilityBytes(usage)} used)`
    : 'Quota estimate unavailable; storage must be checked again before hosted index download.';
  const hisat2 = capabilities.workflows.hisat2_browser;
  els.hisat2Availability.textContent = hisat2.engine_available
    ? (hisat2.supported ? 'Experimental W5 workflow is available; production-scale W6 validation is pending.' : `Disabled: ${hisat2.missing.join(', ')}.`)
    : 'HISAT2 Web engines are unavailable in this build.';
  updateControls();
}

for (const input of document.querySelectorAll('input, select')) {
  input.addEventListener('change', () => {
    if (input === els.transcriptomeFile) {
      state.generatedIndex = null;
      state.generatedIndexName = 'transcripts.idx';
    }
    updateControls();
  });
  input.addEventListener('input', updateControls);
}

els.buildIndexButton.addEventListener('click', buildIndex);
els.addSampleButton.addEventListener('click', addSample);
els.downloadIndexButton.addEventListener('click', () => {
  if (state.generatedIndex) downloadBlob(state.generatedIndex, state.generatedIndexName);
});
els.cancelIndexButton.addEventListener('click', () => {
  if (runner.cancel()) {
    state.running = null;
    finishProgress(els.indexProgress, els.indexProgressLabel, 'Index build stopped', true);
    els.progressStatus.textContent = 'Stopped';
    appendLog(els.indexLog, ['Stopped by user.'], '[web] ');
    updateControls();
  }
});
els.runQuantButton.addEventListener('click', runQuant);
els.cancelQuantButton.addEventListener('click', () => {
  if (state.preprocessor?.cancel() || runner.cancel()) {
    state.cancelRequested = true;
    finishProgress(els.quantProgress, els.quantProgressLabel, 'Quantification stopped', true);
    els.progressStatus.textContent = 'Stopped';
    appendLog(els.quantLog, ['Stopped by user.'], '[web] ');
    updateControls();
  }
});
els.deleteKallistoFastp.addEventListener('click', async () => {
  els.deleteKallistoFastp.disabled = true;
  try {
    const removed = await cleanupKallistoFastp();
    els.deleteKallistoFastp.hidden = true;
    els.kallistoFastpCleanupStatus.textContent = `Deleted ${removed.length} cleaned FASTQ artifact${removed.length === 1 ? '' : 's'} from browser storage.`;
    renderResults(Number(els.quantElapsed.textContent.replace(/[^0-9.]/g, '')) || 0);
    els.deleteKallistoFastp.hidden = true;
    els.kallistoFastpCleanupStatus.textContent = `Deleted ${removed.length} cleaned FASTQ artifact${removed.length === 1 ? '' : 's'} from browser storage.`;
  } catch (error) {
    els.deleteKallistoFastp.disabled = false;
    els.kallistoFastpCleanupStatus.textContent = `Cleanup failed: ${error.message || error}`;
  }
});

window.addEventListener('pagehide', () => {
  state.preprocessor?.cancel();
  if (state.retainedFastpEntries.length) cleanupKallistoFastp().catch(() => {});
}, { once: true });

addSample();
initRuntime();
