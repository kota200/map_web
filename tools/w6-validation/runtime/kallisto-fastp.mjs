import { W3StorageClient } from '../../w3-storage/runtime/storage-client.mjs';
import { combineFastqFiles, safeSampleId } from '../../w5-pipeline/runtime/preflight.mjs';
import { summarizeFastp } from '../../w5-pipeline/runtime/results.mjs';

function abortError(message = 'fastp preprocessing stopped by user.') {
  return new DOMException(message, 'AbortError');
}

function normalizeSample(sample, index) {
  const paired = sample?.mode === 'paired' || sample?.mode === 'pe';
  const read1 = paired ? Array.from(sample.r1 || sample.read1 || []) : Array.from(sample.single || sample.read1 || []);
  const read2 = paired ? Array.from(sample.r2 || sample.read2 || []) : [];
  if (!String(sample?.name || '').trim()) throw new Error(`Sample ${index + 1} needs a name.`);
  if (!read1.length) throw new Error(`${sample.name}: no Read 1/SE FASTQ files were supplied to fastp.`);
  if (paired && read1.length !== read2.length) throw new Error(`${sample.name}: R1/R2 file counts must match before fastp.`);
  return { original: sample, name: String(sample.name).trim(), sampleId: safeSampleId(sample.name, index), mode: paired ? 'pe' : 'se', read1, read2 };
}

async function removeWithRetry(client, entryId) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await client.request('remove', { entryId });
      return true;
    } catch (error) {
      lastError = error;
      if (!['NoModificationAllowedError', 'InvalidStateError'].includes(error?.name) || attempt === 5) break;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw lastError;
}

export class KallistoFastpPreprocessor {
  constructor({ onEvent = null } = {}) {
    this.onEvent = onEvent;
    this.running = false;
    this.cancelled = false;
    this.worker = null;
    this.rejectActive = null;
    this.entryIds = [];
  }

  #emit(type, sample, message, details = {}) {
    this.onEvent?.({
      schema_version: 1,
      type,
      timestamp: new Date().toISOString(),
      stage: 'fastp',
      sample,
      message,
      ...(type === 'progress' ? { kind: details.kind ?? 'indeterminate', ...details } : { level: details.level ?? 'info' }),
    });
  }

  #runWorker(message, sample) {
    const worker = new Worker(new URL('../../w3-storage/runtime/fastp-opfs-worker.mjs', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise((resolve, reject) => {
      this.rejectActive = reject;
      const finish = () => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        this.rejectActive = null;
      };
      worker.onmessage = (event) => {
        const data = event.data;
        if (data?.type === 'running') {
          this.#emit('log', sample, `Exact arguments: ${JSON.stringify(data.args || [])}`);
          this.#emit('progress', sample, 'fastp command started.');
        } else if (data?.type === 'stdout' || data?.type === 'stderr') {
          this.#emit('log', sample, data.line, { level: data.type === 'stderr' ? 'warning' : 'info' });
        } else if (data?.type === 'result') {
          finish();
          resolve(data.result);
        } else if (data?.type === 'error') {
          finish();
          const error = new Error(data.message || 'fastp Worker failed.');
          error.name = data.name || 'Error';
          reject(error);
        }
      };
      worker.onerror = (event) => {
        finish();
        reject(new Error(event.message || 'fastp Worker failed.'));
      };
      worker.postMessage(message);
    });
  }

  async run(samples, { threads = 1, lengthRequired = 15 } = {}) {
    if (this.running) throw new Error('Kallisto fastp preprocessing is already running.');
    if (!Number.isInteger(threads) || threads < 1 || threads > 4) throw new Error('fastp threads must be an integer from 1 to 4.');
    if (!Number.isInteger(lengthRequired) || lengthRequired < 1 || lengthRequired > 100000) throw new Error('fastp minimum length is invalid.');
    const normalized = Array.from(samples || [], normalizeSample);
    if (!normalized.length) throw new Error('At least one sample is required for fastp preprocessing.');
    this.running = true;
    this.cancelled = false;
    this.entryIds = [];
    const client = new W3StorageClient();
    const results = [];
    try {
      for (const [index, sample] of normalized.entries()) {
        if (this.cancelled) throw abortError();
        this.#emit('progress', sample.name, `Preprocessing sample ${index + 1} of ${normalized.length}.`, { kind: 'determinate', completed: index, total: normalized.length, unit: 'samples' });
        const read1 = combineFastqFiles(sample.read1, `${sample.sampleId}-read1`);
        const read2 = sample.mode === 'pe' ? combineFastqFiles(sample.read2, `${sample.sampleId}-read2`) : null;
        const outputEntries = sample.mode === 'pe'
          ? { 'pe.R1.cleaned.fastq.gz': `w6-kallisto-${crypto.randomUUID()}-r1`, 'pe.R2.cleaned.fastq.gz': `w6-kallisto-${crypto.randomUUID()}-r2` }
          : { 'se.cleaned.fastq.gz': `w6-kallisto-${crypto.randomUUID()}-r1` };
        this.entryIds.push(...Object.values(outputEntries));
        const started = performance.now();
        const result = await this.#runWorker({
          type: 'run',
          config: {
            mode: sample.mode,
            inputs: { read1, ...(read2 ? { read2 } : {}) },
            options: { threads, lengthRequired, compression: 4, reportTitle: `${sample.name} fastp preprocessing for kallisto` },
          },
          outputEntries,
        }, sample.name);
        if (result.exitCode !== 0) throw new Error(`${sample.name}: fastp exited with code ${result.exitCode}.`);
        const cleaned = [];
        for (const [name, entryId] of Object.entries(outputEntries)) {
          const stored = await client.request('get-file', { entryId });
          cleaned.push({ name, entryId, file: stored.file, sizeBytes: stored.file.size });
        }
        const jsonName = `${sample.mode}.fastp.json`;
        const htmlName = `${sample.mode}.fastp.html`;
        const jsonText = new TextDecoder().decode(result.outputs[jsonName]);
        const elapsedMs = performance.now() - started;
        const processed = sample.mode === 'pe'
          ? { ...sample.original, mode: 'paired', r1: [cleaned[0].file], r2: [cleaned[1].file], valid: true }
          : { ...sample.original, mode: 'single', single: [cleaned[0].file], valid: true };
        results.push({
          name: sample.name,
          sampleId: sample.sampleId,
          processed,
          cleaned,
          qc: summarizeFastp(JSON.parse(jsonText), elapsedMs),
          args: result.args,
          reports: [
            { name: jsonName, blob: new Blob([jsonText], { type: 'application/json' }) },
            { name: htmlName, blob: new Blob([result.outputs[htmlName]], { type: 'text/html' }) },
          ],
          logs: { stdout: result.stdout, stderr: result.stderr },
          elapsedMs,
        });
        this.#emit('progress', sample.name, `fastp completed for ${sample.name}.`, { kind: 'determinate', completed: index + 1, total: normalized.length, unit: 'samples', elapsed_ms: Math.round(elapsedMs) });
      }
      return { samples: results, retainedEntries: [...this.entryIds] };
    } catch (error) {
      await this.cleanup(this.entryIds, client).catch((cleanupError) => { error.cleanupError = cleanupError; });
      if (this.cancelled && error?.name !== 'AbortError') throw abortError(error?.message);
      throw error;
    } finally {
      this.worker?.terminate();
      this.worker = null;
      this.rejectActive = null;
      client.close();
      this.running = false;
    }
  }

  async cleanup(entryIds = this.entryIds, existingClient = null) {
    const client = existingClient || new W3StorageClient();
    const removed = [];
    try {
      for (const entryId of [...new Set(entryIds || [])]) {
        await removeWithRetry(client, entryId);
        removed.push(entryId);
      }
      this.entryIds = this.entryIds.filter((entryId) => !removed.includes(entryId));
      return removed;
    } finally {
      if (!existingClient) client.close();
    }
  }

  cancel() {
    if (!this.running) return false;
    this.cancelled = true;
    this.worker?.terminate();
    this.worker = null;
    const reject = this.rejectActive;
    this.rejectActive = null;
    reject?.(abortError());
    return true;
  }
}
