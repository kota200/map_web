import { W4IndexCacheClient } from '../../w4-catalog/runtime/cache-client.mjs';
import { W3StorageClient } from '../../w3-storage/runtime/storage-client.mjs';
import { combineFastqFiles, preflightSamples } from './preflight.mjs';
import {
  buildMatrices,
  calculateTpm,
  countsTsv,
  countsWithTpmTsv,
  parseAssignmentSummary,
  parseFeatureCounts,
  summarizeFastp,
} from './results.mjs';
import { assertHisat2WebResources } from '../../w6-validation/runtime/resource-policy.mjs';

const encoder = new TextEncoder();

function nowIso() { return new Date().toISOString(); }

function abortError(message = 'Analysis stopped by user.') {
  return new DOMException(message, 'AbortError');
}

function validateOptions(options = {}) {
  const threads = Number(options.threads ?? 1);
  const strandedness = Number(options.strandedness ?? 0);
  const featureType = String(options.featureType ?? 'exon').trim();
  const attribute = String(options.attribute ?? 'gene_id').trim();
  if (!Number.isInteger(threads) || threads < 1 || threads > 4) throw new Error('Threads must be an integer from 1 to 4 for the validated W5 engines.');
  if (![0, 1, 2].includes(strandedness)) throw new Error('Strandedness must be 0, 1, or 2.');
  if (!featureType || /[\t\r\n]/.test(featureType)) throw new Error('Feature type must be a non-empty single-line value.');
  if (!attribute || /[\t\r\n]/.test(attribute)) throw new Error('Grouping attribute must be a non-empty single-line value.');
  return {
    threads,
    strandedness,
    featureType,
    attribute,
    runFastp: options.runFastp === true,
    fastpLengthRequired: Number(options.fastpLengthRequired ?? 15),
  };
}

async function sha256Blob(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function memoryOutput(relativePath, content, role, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  return {
    record: { relative_path: relativePath, size_bytes: blob.size, sha256: await sha256Blob(blob), role },
    source: { kind: 'memory', blob },
  };
}

function opfsOutput(relativePath, artifact, role = 'primary') {
  return {
    record: { relative_path: relativePath, size_bytes: artifact.sizeBytes, role },
    source: { kind: 'opfs', entryId: artifact.entryId },
  };
}

function fileDescriptor(file) {
  return { basename: String(file.name), size_bytes: file.size, content_encoding: /\.gz$/i.test(file.name) ? 'gzip' : 'identity' };
}

function jobDescriptor(jobId, reference, samples, options) {
  return {
    schema_version: 1,
    job_id: jobId,
    mode: 'web',
    engine: 'hisat2-featurecounts',
    samples: samples.map((sample) => ({
      name: sample.name,
      read_mode: sample.mode === 'pe' ? 'paired-end' : 'single-end',
      inputs: sample.mode === 'pe'
        ? { r1: sample.read1.map(fileDescriptor), r2: sample.read2.map(fileDescriptor) }
        : { single: sample.read1.map(fileDescriptor) },
    })),
    reference: {
      kind: 'hosted-hisat2-index',
      id: reference.id,
      size_bytes: reference.total_size,
      assembly: reference.assembly,
      annotation_version: reference.annotation.version,
    },
    options: {
      threads: options.threads,
      stages: [...(options.runFastp ? ['fastp'] : []), 'hisat2', 'featureCounts', 'tpm'],
      arguments: { fastp: [], hisat2: [], featureCounts: [] },
    },
    privacy: {
      local_input_processing: true,
      uploads_biological_data: false,
      network_purposes: ['static-app', 'wasm-runtime', 'hosted-reference', 'hosted-annotation'],
    },
  };
}

async function cleanupPrefix(storage, prefix) {
  const entries = await storage.request('list');
  const targets = entries.filter((entry) => entry.entryId.startsWith(prefix));
  const removed = [];
  for (const entry of targets) {
    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await storage.request('remove', { entryId: entry.entryId });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (!['NoModificationAllowedError', 'InvalidStateError'].includes(error?.name) || attempt === 5) break;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
    if (lastError) throw lastError;
    removed.push(entry.entryId);
  }
  return removed;
}

export class Hisat2WebRunner {
  constructor({ onEvent = null } = {}) {
    this.onEvent = onEvent;
    this.running = false;
    this.cancelled = false;
    this.activeWorker = null;
    this.activeReject = null;
    this.cacheClient = null;
  }

  #emit(type, stage, message, sample = null, details = {}) {
    const event = type === 'progress'
      ? { schema_version: 1, type, timestamp: nowIso(), stage, kind: details.kind ?? 'indeterminate', message, ...(details.completed != null ? { completed: details.completed } : {}), ...(details.total != null ? { total: details.total } : {}), ...(details.unit ? { unit: details.unit } : {}), ...(details.elapsed_ms != null ? { elapsed_ms: Math.round(details.elapsed_ms) } : {}) }
      : { schema_version: 1, type: 'log', timestamp: nowIso(), stage, level: details.level ?? 'info', message };
    if (sample) event.sample = sample;
    this.onEvent?.(event);
  }

  #throwIfCancelled() {
    if (this.cancelled) throw abortError();
  }

  #runWorker(relativeUrl, message, stage, sample) {
    const worker = new Worker(new URL(relativeUrl, import.meta.url), { type: 'module' });
    this.activeWorker = worker;
    const streamed = { stdout: [], stderr: [], args: null };
    return new Promise((resolve, reject) => {
      this.activeReject = reject;
      worker.onmessage = (event) => {
        const data = event.data;
        if (data?.type === 'running') {
          streamed.args = [...(data.args || [])];
          this.#emit('log', stage, `Exact arguments: ${JSON.stringify(streamed.args)}`, sample);
          this.#emit('progress', stage, `${stage} command started.`, sample);
        } else if (data?.type === 'stdout') {
          streamed.stdout.push(data.line);
          this.#emit('log', stage, data.line, sample, { level: 'info' });
        } else if (data?.type === 'stderr') {
          streamed.stderr.push(data.line);
          this.#emit('log', stage, data.line, sample, { level: 'info' });
        } else if (data?.type === 'result') {
          worker.terminate();
          this.activeWorker = null;
          this.activeReject = null;
          resolve({ result: data.result, streamed });
        } else if (data?.type === 'error') {
          worker.terminate();
          this.activeWorker = null;
          this.activeReject = null;
          const error = new Error(data.message || `${stage} failed.`);
          error.name = data.name || 'Error';
          error.workerStack = data.stack || null;
          reject(error);
        }
      };
      worker.onerror = (event) => {
        worker.terminate();
        this.activeWorker = null;
        this.activeReject = null;
        const detail = event.message || event.error?.message || String(event.error || event);
        reject(new Error(`${stage} Worker failed: ${detail}.`));
      };
      worker.postMessage(message);
    });
  }

  async run({ reference, samples, options: rawOptions = {} }) {
    if (this.running) throw new Error('A HISAT2 Web job is already running.');
    this.running = true;
    this.cancelled = false;
    const jobId = `w5-${crypto.randomUUID()}`;
    const prefix = `${jobId}-`;
    const storage = new W3StorageClient();
    this.cacheClient = new W4IndexCacheClient();
    const outputSources = new Map();
    const removed = [];
    const retained = [];
    let normalizedSamples = [];
    let descriptor = null;
    const completedSamples = [];
    try {
      const options = validateOptions(rawOptions);
      this.#emit('progress', 'preflight', 'Checking samples, filenames, FASTQ structure, and R1/R2 pairing.');
      normalizedSamples = await preflightSamples(samples);
      this.#throwIfCancelled();
      descriptor = jobDescriptor(jobId, reference, normalizedSamples, options);
      const storageEstimate = await navigator.storage?.estimate?.().catch(() => ({})) || {};
      const availableBytes = Number.isFinite(storageEstimate.quota) && Number.isFinite(storageEstimate.usage)
        ? storageEstimate.quota - storageEstimate.usage
        : null;
      const resourceEstimate = assertHisat2WebResources({ referenceBytes: reference.total_size, samples: normalizedSamples, runFastp: options.runFastp, availableBytes });
      descriptor.options.resource_estimate = resourceEstimate;
      for (const warning of resourceEstimate.warnings) this.#emit('log', 'preflight', warning, null, { level: resourceEstimate.recommendDesktop ? 'warning' : 'info' });
      this.#emit('progress', 'download', 'Verifying the hosted reference cache.', null, { kind: 'determinate', completed: 0, total: reference.total_size, unit: 'bytes' });
      const cacheResult = await this.cacheClient.request('download', { reference }, (progress) => {
        this.#emit('progress', 'download', `${progress.stage === 'verify' ? 'Verifying' : 'Downloading'} ${progress.file || 'reference package'}.`, null, {
          kind: 'determinate', completed: progress.completedBytes ?? 0, total: progress.totalBytes ?? reference.total_size, unit: 'bytes',
        });
      });
      this.#throwIfCancelled();

      for (const [sampleIndex, sample] of normalizedSamples.entries()) {
        this.#throwIfCancelled();
        this.#emit('progress', 'preflight', `Starting sample ${sampleIndex + 1} of ${normalizedSamples.length}.`, sample.name, { kind: 'determinate', completed: sampleIndex, total: normalizedSamples.length, unit: 'samples' });
        const sampleStarted = performance.now();
        const sampleOutputs = [];
        const sampleTimings = {};
        const exactArguments = {};
        const logs = {};
        let fastpQc = null;
        let readEntries = null;
        const temporaryReadEntries = [];
        const read1 = combineFastqFiles(sample.read1, `${sample.sampleId}-read1`);
        const read2 = sample.mode === 'pe' ? combineFastqFiles(sample.read2, `${sample.sampleId}-read2`) : null;

        if (options.runFastp) {
          const stageStarted = performance.now();
          const outputEntries = sample.mode === 'pe'
            ? {
                'pe.R1.cleaned.fastq.gz': `${prefix}${sample.sampleId}-fastp-r1`,
                'pe.R2.cleaned.fastq.gz': `${prefix}${sample.sampleId}-fastp-r2`,
              }
            : { 'se.cleaned.fastq.gz': `${prefix}${sample.sampleId}-fastp-r1` };
          const fastpRun = await this.#runWorker('../../w3-storage/runtime/fastp-opfs-worker.mjs', {
            type: 'run',
            config: {
              mode: sample.mode,
              inputs: { read1, ...(read2 ? { read2 } : {}) },
              options: { threads: options.threads, lengthRequired: options.fastpLengthRequired, compression: 4, reportTitle: `${sample.name} fastp preprocessing` },
            },
            outputEntries,
          }, 'fastp', sample.name);
          if (fastpRun.result.exitCode !== 0) throw new Error(`${sample.name}: fastp exited with code ${fastpRun.result.exitCode}.`);
          sampleTimings.fastpMs = performance.now() - stageStarted;
          exactArguments.fastp = fastpRun.result.args;
          logs.fastp = { stdout: fastpRun.result.stdout, stderr: fastpRun.result.stderr };
          const jsonName = `${sample.mode}.fastp.json`;
          const htmlName = `${sample.mode}.fastp.html`;
          const jsonText = new TextDecoder().decode(fastpRun.result.outputs[jsonName]);
          const htmlBytes = fastpRun.result.outputs[htmlName];
          fastpQc = summarizeFastp(JSON.parse(jsonText), sampleTimings.fastpMs);
          for (const [name, artifact] of Object.entries(fastpRun.result.outputArtifacts)) {
            const relative = `${sample.sampleId}/fastp/${name}`;
            const output = opfsOutput(relative, artifact);
            sampleOutputs.push(output.record); outputSources.set(relative, output.source); retained.push(artifact.entryId);
          }
          for (const [relative, content, role, type] of [
            [`${sample.sampleId}/fastp/${jsonName}`, jsonText, 'report', 'application/json'],
            [`${sample.sampleId}/fastp/${htmlName}`, htmlBytes, 'report', 'text/html'],
          ]) {
            const output = await memoryOutput(relative, content, role, type);
            sampleOutputs.push(output.record); outputSources.set(relative, output.source);
          }
          readEntries = sample.mode === 'pe'
            ? { read1: outputEntries['pe.R1.cleaned.fastq.gz'], read2: outputEntries['pe.R2.cleaned.fastq.gz'] }
            : { read1: outputEntries['se.cleaned.fastq.gz'] };
        }

        if (options.runFastp || sample.gzip) {
          const decompressed = {};
          for (const mate of sample.mode === 'pe' ? ['read1', 'read2'] : ['read1']) {
            const targetEntryId = `${prefix}${sample.sampleId}-hisat-${mate}`;
            const sourceEntryId = options.runFastp ? readEntries[mate] : null;
            const file = options.runFastp ? null : (mate === 'read1' ? read1 : read2);
            const decompression = await this.#runWorker('./decompress-fastq-worker.mjs', { type: 'run', sourceEntryId, file, targetEntryId }, options.runFastp ? 'fastp' : 'preflight', sample.name);
            if (decompression.result.state?.status !== 'ready') throw new Error(`${sample.name}: gzip FASTQ decompression did not commit.`);
            decompressed[mate] = targetEntryId;
            temporaryReadEntries.push(targetEntryId);
          }
          readEntries = decompressed;
        }

        const samEntryId = `${prefix}${sample.sampleId}-sam`;
        const hisatStarted = performance.now();
        const hisatRun = await this.#runWorker('./hisat2-catalog-worker.mjs', {
          type: 'run',
          reference,
          config: { mode: sample.mode, inputs: readEntries ? {} : { read1, ...(read2 ? { read2 } : {}) }, options: { threads: options.threads } },
          readEntries,
          samEntryId,
        }, 'hisat2', sample.name);
        if (hisatRun.result.exitCode !== 0) throw new Error(`${sample.name}: HISAT2 exited with code ${hisatRun.result.exitCode}.`);
        sampleTimings.hisat2Ms = performance.now() - hisatStarted;
        exactArguments.hisat2 = hisatRun.result.args;
        logs.hisat2 = { stdout: hisatRun.result.stdout, stderr: hisatRun.result.stderr };
        for (const entryId of temporaryReadEntries) {
          const result = await storage.request('remove', { entryId });
          if (result.removed !== false) removed.push(entryId);
        }

        const featureStarted = performance.now();
        const featureRun = await this.#runWorker('./featurecounts-catalog-worker.mjs', {
          type: 'run',
          reference,
          samEntryId,
          config: { mode: sample.mode, inputs: {}, options: { threads: options.threads, strandedness: options.strandedness, featureType: options.featureType, attribute: options.attribute } },
        }, 'featureCounts', sample.name);
        if (featureRun.result.exitCode !== 0) throw new Error(`${sample.name}: featureCounts exited with code ${featureRun.result.exitCode}.`);
        sampleTimings.featureCountsMs = performance.now() - featureStarted;
        exactArguments.featureCounts = featureRun.result.args;
        logs.featureCounts = { stdout: featureRun.result.stdout, stderr: featureRun.result.stderr };
        const rawCounts = featureRun.result.outputs['featureCounts.txt'];
        const rawSummary = featureRun.result.outputs['featureCounts.txt.summary'];
        const countRows = parseFeatureCounts(rawCounts);
        const assignmentSummary = parseAssignmentSummary(rawSummary);
        const tpmStarted = performance.now();
        const tpm = calculateTpm(countRows);
        sampleTimings.tpmMs = performance.now() - tpmStarted;
        sampleTimings.totalMs = performance.now() - sampleStarted;
        const tpmRows = tpm.rows;

        const textOutputs = [
          [`${sample.sampleId}/counts.tsv`, countsTsv(countRows), 'primary'],
          [`${sample.sampleId}/counts_with_tpm.tsv`, countsWithTpmTsv(tpmRows), 'primary'],
          [`${sample.sampleId}/featureCounts.txt`, rawCounts, 'primary'],
          [`${sample.sampleId}/featureCounts.txt.summary`, rawSummary, 'report'],
          [`${sample.sampleId}/hisat2_summary.txt`, `${hisatRun.result.stderr.join('\n')}\n`, 'report'],
        ];
        for (const [tool, streams] of Object.entries(logs)) {
          if (streams.stdout.length) textOutputs.push([`${sample.sampleId}/logs/${tool}.stdout.txt`, `${streams.stdout.join('\n')}\n`, 'log']);
          if (streams.stderr.length) textOutputs.push([`${sample.sampleId}/logs/${tool}.stderr.txt`, `${streams.stderr.join('\n')}\n`, 'log']);
        }
        const runInfo = {
          schema_version: 1,
          job_id: jobId,
          sample: sample.name,
          sample_id: sample.sampleId,
          mode: sample.mode,
          counting_unit: sample.mode === 'pe' ? 'fragments' : 'reads',
          reference: { id: reference.id, assembly: reference.assembly, hisat2_version: reference.hisat2_version, cache_key: cacheResult.cacheKey, annotation_version: reference.annotation.version },
          annotation_parameters: { format: reference.annotation.format, feature_type: options.featureType, grouping_attribute: options.attribute, strandedness: options.strandedness },
          exact_arguments: exactArguments,
          preflight: sample.preflight,
          timings_ms: sampleTimings,
          mapping: { summary: hisatRun.result.stderr, contig_check: featureRun.result.contigCheck },
          featureCounts: { assignment_summary: assignmentSummary },
          tpm: { formula: 'count/Length divided by sum(count/Length) times 1000000', denominator: tpm.denominator, warnings: tpm.warnings },
          ...(fastpQc ? { fastp: fastpQc } : {}),
        };
        textOutputs.push([`${sample.sampleId}/run_info.json`, `${JSON.stringify(runInfo, null, 2)}\n`, 'metadata']);
        for (const [relative, content, role] of textOutputs) {
          const output = await memoryOutput(relative, content, role, relative.endsWith('.json') ? 'application/json' : 'text/plain;charset=utf-8');
          sampleOutputs.push(output.record); outputSources.set(relative, output.source);
        }

        const samRemoved = await storage.request('remove', { entryId: samEntryId });
        if (samRemoved.removed !== false) removed.push(samEntryId);
        completedSamples.push({ name: sample.name, sampleId: sample.sampleId, status: 'completed', outputs: sampleOutputs, tpmRows, runInfo });
        if (sampleIndex === 0) descriptor.options.arguments = structuredClone(exactArguments);
        this.#emit('progress', 'cleanup', `Completed ${sample.name}; temporary SAM removed.`, sample.name, { kind: 'determinate', completed: sampleIndex + 1, total: normalizedSamples.length, unit: 'samples', elapsed_ms: sampleTimings.totalMs });
      }

      const batchOutputs = [];
      if (completedSamples.length > 1) {
        const matrices = buildMatrices(completedSamples);
        for (const [relative, content] of [['counts_matrix.tsv', matrices.counts], ['tpm_matrix.tsv', matrices.tpm]]) {
          const output = await memoryOutput(relative, content, 'matrix');
          batchOutputs.push(output.record); outputSources.set(relative, output.source);
        }
      }
      const batchManifestContent = {
        schema_version: 1,
        job: descriptor,
        reference: { id: reference.id, assembly: reference.assembly, annotation_version: reference.annotation.version },
        samples: completedSamples.map((sample) => ({ name: sample.name, sample_id: sample.sampleId, counting_unit: sample.runInfo.counting_unit, outputs: sample.outputs.map((output) => output.relative_path) })),
        matrices: batchOutputs.map((output) => output.relative_path),
        created_at: nowIso(),
      };
      const batchManifestOutput = await memoryOutput('batch_manifest.json', `${JSON.stringify(batchManifestContent, null, 2)}\n`, 'metadata', 'application/json');
      batchOutputs.push(batchManifestOutput.record); outputSources.set('batch_manifest.json', batchManifestOutput.source);
      const manifest = {
        schema_version: 1,
        job_id: jobId,
        status: 'completed',
        engine: 'hisat2-featurecounts',
        samples: completedSamples.map((sample) => ({ name: sample.name, status: 'completed', outputs: sample.outputs })),
        outputs: batchOutputs,
        warnings: completedSamples.flatMap((sample) => sample.runInfo.tpm.warnings.map((warning) => `${sample.name}: ${warning}`)),
        cleanup: { status: 'completed', removed, retained, message: 'Temporary SAM artifacts were removed; cleaned FASTQ outputs are retained only when fastp ran.' },
      };
      return { job: descriptor, manifest, samples: completedSamples, outputSources, retainedArtifacts: retained };
    } catch (error) {
      const cancelled = this.cancelled || error?.name === 'AbortError';
      let cleanupRemoved = [];
      try { cleanupRemoved = await cleanupPrefix(storage, prefix); } catch (cleanupError) { error.cleanupError = cleanupError; }
      const finalError = cancelled && error?.name !== 'AbortError' ? abortError(error?.message || 'Analysis stopped by user.') : error;
      const failureManifest = {
        schema_version: 1,
        job_id: jobId,
        status: cancelled ? 'cancelled' : 'failed',
        engine: 'hisat2-featurecounts',
        samples: normalizedSamples.map((sample, index) => ({ name: sample.name, status: index < completedSamples.length ? 'completed' : (cancelled ? 'cancelled' : 'failed'), outputs: index < completedSamples.length ? completedSamples[index].outputs : [] })),
        outputs: [],
        warnings: [error.message || String(error)],
        cleanup: { status: error.cleanupError ? 'failed' : 'completed', removed: cleanupRemoved, retained: [], message: error.cleanupError?.message || 'All W5 job artifacts were removed.' },
      };
      finalError.manifest = failureManifest;
      throw finalError;
    } finally {
      this.activeWorker?.terminate();
      this.activeWorker = null;
      this.activeReject = null;
      this.cacheClient?.close();
      this.cacheClient = null;
      storage.close();
      this.running = false;
    }
  }

  cancel() {
    if (!this.running) return false;
    this.cancelled = true;
    this.cacheClient?.close();
    if (this.activeWorker) {
      this.activeWorker.terminate();
      this.activeWorker = null;
      const reject = this.activeReject;
      this.activeReject = null;
      reject?.(abortError());
    }
    return true;
  }
}

export async function materializeOutput(source) {
  if (!source || !['memory', 'opfs'].includes(source.kind)) throw new TypeError('Unknown W5 output source.');
  if (source.kind === 'memory') return source.blob;
  const client = new W3StorageClient();
  try { return (await client.request('get-file', { entryId: source.entryId })).file; }
  finally { client.close(); }
}

export async function deleteRetainedArtifacts(entryIds) {
  const client = new W3StorageClient();
  const removed = [];
  try {
    for (const entryId of entryIds || []) {
      const result = await client.request('remove', { entryId });
      if (result.removed !== false) removed.push(entryId);
    }
    return removed;
  } finally { client.close(); }
}
