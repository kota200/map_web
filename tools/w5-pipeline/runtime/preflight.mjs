const FASTQ_EXTENSION = /\.(?:fastq|fq)(?:\.gz)?$/i;

function requireFile(value, label) {
  if (typeof Blob === 'undefined' || !(value instanceof Blob)) throw new TypeError(`${label} must be a browser File or Blob.`);
  const name = String(value.name || '');
  if (!name || !FASTQ_EXTENSION.test(name)) throw new TypeError(`${label}: ${name || 'unnamed input'} must end in .fastq, .fq, .fastq.gz, or .fq.gz.`);
  if (!Number.isFinite(value.size) || value.size <= 0) throw new Error(`${label}: ${name} is empty.`);
  return value;
}

function normalizedReadId(header) {
  const token = String(header).replace(/^@/, '').trim().split(/\s+/, 1)[0];
  return token.replace(/\/[12]$/, '');
}

async function readFastqPreview(file, maxChars = 262144) {
  const gzip = /\.gz$/i.test(file.name || '');
  if (!gzip) {
    const text = await file.slice(0, maxChars).text();
    return { text, complete: file.size <= maxChars };
  }
  if (typeof DecompressionStream !== 'function') return { text: null, complete: false };
  try {
    const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const decoder = new TextDecoder();
    let text = '';
    let complete = false;
    while (text.length < maxChars) {
      const { value, done } = await reader.read();
      if (done) { complete = true; break; }
      text += decoder.decode(value, { stream: true });
      if ((text.match(/\n/g) || []).length >= 20) break;
    }
    text += decoder.decode();
    if (!complete) await reader.cancel().catch(() => {});
    return { text, complete };
  } catch (error) {
    throw new Error(`${file.name}: gzip FASTQ preview failed (${error?.message || error}).`);
  }
}

function parsePreview(text, label, complete) {
  if (text == null) return { headers: [], inspectedRecords: 0, gzipInspectionUnavailable: true };
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const recordCount = Math.min(4, Math.floor(lines.length / 4));
  if (recordCount < 1) throw new Error(`${label} does not contain one complete FASTQ record.`);
  if (complete && lines.length % 4 !== 0) throw new Error(`${label} ends with an incomplete FASTQ record.`);
  const headers = [];
  for (let record = 0; record < recordCount; record += 1) {
    const at = record * 4;
    const header = lines[at] || '';
    const sequence = lines[at + 1] || '';
    const plus = lines[at + 2] || '';
    const quality = lines[at + 3] || '';
    if (!header.startsWith('@')) throw new Error(`${label}, record ${record + 1}: header must start with @.`);
    if (!plus.startsWith('+')) throw new Error(`${label}, record ${record + 1}: third line must start with +.`);
    if (!sequence.length) throw new Error(`${label}, record ${record + 1}: sequence is empty.`);
    if (sequence.length !== quality.length) throw new Error(`${label}, record ${record + 1}: sequence and quality lengths differ.`);
    headers.push(normalizedReadId(header));
  }
  return { headers, inspectedRecords: recordCount, gzipInspectionUnavailable: false };
}

async function inspectFile(file, label) {
  requireFile(file, label);
  const preview = await readFastqPreview(file);
  return { file, gzip: /\.gz$/i.test(file.name || ''), ...parsePreview(preview.text, `${label}: ${file.name}`, preview.complete) };
}

function validateSampleName(name, index, names) {
  const value = String(name ?? '').trim();
  if (!value) throw new Error(`Sample ${index + 1} name must not be empty.`);
  if (value.length > 120) throw new Error(`${value.slice(0, 24)}…: sample name exceeds 120 characters.`);
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${value || `Sample ${index + 1}`}: control characters are not allowed in sample names.`);
  if (names.has(value)) throw new Error(`Duplicate sample name: ${value}.`);
  names.add(value);
  return value;
}

export function safeSampleId(name, index = 0) {
  const ascii = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.{2,}/g, '-').replace(/^[._-]+|[._-]+$/g, '').slice(0, 72);
  return `sample-${String(index + 1).padStart(2, '0')}-${ascii || 'unicode'}`;
}

function requireConsistentCompression(inspections, label) {
  if (new Set(inspections.map((entry) => entry.gzip)).size > 1) throw new Error(`${label}: compressed and uncompressed FASTQ files cannot be combined in one input.`);
}

export async function preflightSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('Add at least one sample.');
  const names = new Set();
  const normalized = [];
  for (const [index, sample] of samples.entries()) {
    if (!sample || !['se', 'pe'].includes(sample.mode)) throw new Error(`Sample ${index + 1}: mode must be se or pe.`);
    const name = validateSampleName(sample.name, index, names);
    const read1 = Array.from(sample.read1 || []);
    const read2 = Array.from(sample.read2 || []);
    if (read1.length === 0) throw new Error(`${name}: select at least one Read 1/SE FASTQ file.`);
    if (sample.mode === 'pe' && read1.length !== read2.length) throw new Error(`${name}: R1 and R2 file counts must match.`);
    if (sample.mode === 'se' && read2.length) throw new Error(`${name}: Read 2 is not valid in single-end mode.`);
    const r1Inspections = [];
    const r2Inspections = [];
    for (const [fileIndex, file] of read1.entries()) r1Inspections.push(await inspectFile(file, `${name}, R1/SE ${fileIndex + 1}`));
    for (const [fileIndex, file] of read2.entries()) r2Inspections.push(await inspectFile(file, `${name}, R2 ${fileIndex + 1}`));
    requireConsistentCompression(r1Inspections, `${name}, R1/SE`);
    if (sample.mode === 'pe') {
      requireConsistentCompression(r2Inspections, `${name}, R2`);
      if (r1Inspections[0].gzip !== r2Inspections[0].gzip) throw new Error(`${name}: R1 and R2 must use the same compression mode.`);
      for (let lane = 0; lane < r1Inspections.length; lane += 1) {
        const left = r1Inspections[lane].headers;
        const right = r2Inspections[lane].headers;
        const checked = Math.min(left.length, right.length);
        for (let record = 0; record < checked; record += 1) {
          if (left[record] !== right[record]) throw new Error(`${name}, lane ${lane + 1}, record ${record + 1}: R1/R2 read names do not pair (${left[record]} vs ${right[record]}).`);
        }
      }
    }
    normalized.push({
      name,
      sampleId: safeSampleId(name, index),
      mode: sample.mode,
      read1,
      read2,
      gzip: r1Inspections[0].gzip,
      preflight: {
        r1Files: r1Inspections.length,
        r2Files: r2Inspections.length,
        inspectedRecords: r1Inspections.reduce((sum, item) => sum + item.inspectedRecords, 0) + r2Inspections.reduce((sum, item) => sum + item.inspectedRecords, 0),
        gzipInspectionUnavailable: [...r1Inspections, ...r2Inspections].some((item) => item.gzipInspectionUnavailable),
      },
    });
  }
  return normalized;
}

export function combineFastqFiles(files, basename) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('Cannot combine an empty FASTQ file list.');
  const gzip = /\.gz$/i.test(files[0].name || '');
  const name = `${basename}.fastq${gzip ? '.gz' : ''}`;
  return new File(files, name, { type: gzip ? 'application/gzip' : 'text/plain', lastModified: Math.max(...files.map((file) => Number(file.lastModified) || 0)) });
}
