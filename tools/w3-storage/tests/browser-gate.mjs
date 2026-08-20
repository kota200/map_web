import { W3StorageClient } from '../runtime/storage-client.mjs';

const TEST_PREFIX = 'w3-gate-';
const PHASE_KEY = 'kallisto-web-w3-gate-phase-v1';
const LARGE_ENTRY = `${TEST_PREFIX}large-ready`;
const PARTIAL_ENTRY = `${TEST_PREFIX}partial`;
const LARGE_BYTES = 64 * 1024 * 1024;
const statusElement = document.querySelector('#status');
const outputElement = document.querySelector('#output');
const logLines = [];

function record(line) {
  logLines.push(line);
  outputElement.textContent = `${logLines.join('\n')}\n`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fileFromUrl(url, name) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new File([await response.blob()], name);
}

function startResponsivenessMonitor() {
  let last = performance.now();
  let maxHeartbeatGapMs = 0;
  let heartbeatCount = 0;
  const longTasks = [];
  const interval = setInterval(() => {
    const now = performance.now();
    maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - last);
    last = now;
    heartbeatCount += 1;
  }, 16);
  let observer = null;
  if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration));
    });
    observer.observe({ entryTypes: ['longtask'] });
  }
  const heapBefore = Number.isFinite(performance?.memory?.usedJSHeapSize)
    ? performance.memory.usedJSHeapSize
    : 'unavailable';
  return {
    stop() {
      clearInterval(interval);
      observer?.disconnect();
      const heapAfter = Number.isFinite(performance?.memory?.usedJSHeapSize)
        ? performance.memory.usedJSHeapSize
        : 'unavailable';
      return { maxHeartbeatGapMs, heartbeatCount, longTasks, heapBefore, heapAfter };
    },
  };
}

async function removePrefix(client) {
  const entries = await client.request('list');
  const names = entries.filter((entry) => entry.entryId.startsWith(TEST_PREFIX)).map((entry) => entry.entryId);
  for (const entryId of names) await client.request('remove', { entryId });
  return names;
}

function runWorkerOnce(relativeUrl, message, timeoutMs = 120000) {
  const worker = new Worker(new URL(relativeUrl, import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error(`${relativeUrl} timed out.`));
    }, timeoutMs);
    worker.onmessage = (event) => {
      const data = event.data;
      if (data?.type === 'running') record(`${relativeUrl} args: ${JSON.stringify(data.args)}`);
      if (data?.type === 'result') {
        clearTimeout(timeout);
        worker.terminate();
        resolve(data.result);
      } else if (data?.type === 'error') {
        clearTimeout(timeout);
        worker.terminate();
        const error = new Error(data.message || `${relativeUrl} failed.`);
        error.name = data.name || 'Error';
        reject(error);
      }
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || `${relativeUrl} failed.`));
    };
    worker.postMessage(message);
  });
}

function countsProjection(text) {
  const rows = text.trim().split(/\r?\n/).filter((line) => !line.startsWith('#'));
  const fields = rows[1].split('\t');
  return { geneId: fields[0], length: Number(fields[5]), count: Number(fields[6]) };
}

async function runFirstLoad() {
  const client = new W3StorageClient();
  await removePrefix(client);
  const probe = await client.request('probe');
  assert(probe.opfs && probe.syncAccessHandle, 'OPFS synchronous Worker access is required.');
  const quota = await client.request('estimate', { requiredBytes: LARGE_BYTES });
  assert(Number.isFinite(quota.availableBytes), 'Storage quota estimation is required for the W3 gate.');
  assert(quota.allowed !== false, 'The 64 MiB W3 fixture does not fit with required headroom.');
  record(`Storage estimate: ${quota.availableBytes} bytes available.`);

  const monitor = startResponsivenessMonitor();
  const write = await client.request('write-synthetic', {
    entryId: LARGE_ENTRY,
    sizeBytes: LARGE_BYTES,
    chunkBytes: 1024 * 1024,
  });
  const responsiveness = monitor.stop();
  assert(responsiveness.heartbeatCount > 0, 'Main-thread heartbeat did not run during the Worker write.');
  assert(write.state.maxWriteChunkBytes <= 1024 * 1024, 'Synthetic write exceeded its bounded chunk size.');
  record(`64 MiB OPFS write: ${write.throughputMiBps.toFixed(1)} MiB/s; max heartbeat gap ${responsiveness.maxHeartbeatGapMs.toFixed(1)} ms.`);

  await client.request('create-partial', { entryId: PARTIAL_ENTRY, sizeBytes: 1024 * 1024 });
  client.close();
  const phase = { probe, quota, write, responsiveness, createdPartial: PARTIAL_ENTRY };
  sessionStorage.setItem(PHASE_KEY, JSON.stringify(phase));
  statusElement.textContent = 'Reloading to verify persistent-cache integrity and partial cleanup…';
  location.reload();
}

async function cacheTinyIndex(client) {
  const entries = {};
  for (let part = 1; part <= 8; part += 1) {
    const name = `tiny.${part}.ht2`;
    const entryId = `${TEST_PREFIX}index-${part}`;
    await client.request('fetch-to-artifact', {
      entryId,
      url: `../../../test-data/hisat2/native/index/${name}`,
      kind: 'hosted-index-part',
      headroomBytes: 0,
    });
    entries[name] = entryId;
  }
  return entries;
}

async function runFileBackedEngines(client) {
  const fastpInput = await fileFromUrl('../../../test-data/fastp/inputs/se.fastq.gz', 'se.fastq.gz');
  const fastpEntry = `${TEST_PREFIX}fastp-cleaned`;
  const fastpResult = await runWorkerOnce('../runtime/fastp-opfs-worker.mjs', {
    type: 'run',
    config: {
      mode: 'se',
      inputs: { read1: fastpInput },
      options: {
        threads: 1,
        lengthRequired: 15,
        compression: 4,
        reportTitle: 'fastp W3 file-backed output',
        adapterSequence: 'AGATCGGAAGAGCACACGTCTGAACTCCAGTCA',
      },
    },
    outputEntries: { 'se.cleaned.fastq.gz': fastpEntry },
  });
  assert(fastpResult.exitCode === 0, 'fastp OPFS output run failed.');
  assert(!('se.cleaned.fastq.gz' in fastpResult.outputs), 'Cleaned FASTQ was copied back to the main thread.');
  const fastpStored = await client.request('read-artifact', { entryId: fastpEntry });
  assert(fastpStored.bytesRead > 0, 'fastp did not persist cleaned FASTQ.');

  const indexEntries = await cacheTinyIndex(client);
  const read1 = await fileFromUrl('../../../test-data/hisat2/inputs/se.fastq', 'read1.fastq');
  const samEntryId = `${TEST_PREFIX}hisat2-sam`;
  const hisat2Result = await runWorkerOnce('../runtime/hisat2-opfs-worker.mjs', {
    type: 'run',
    config: { mode: 'se', inputs: { read1 }, options: { threads: 1 } },
    indexEntries,
    samEntryId,
  });
  assert(hisat2Result.exitCode === 0, 'HISAT2 OPFS output run failed.');
  assert(Object.keys(hisat2Result.outputs).length === 0, 'SAM was copied back to the main thread.');
  assert(hisat2Result.outputArtifact?.deviceStats?.maxWriteChunkBytes <= 1024 * 1024,
    'HISAT2 SAM was not written in bounded chunks.');

  const annotation = await fileFromUrl('../../../test-data/hisat2/inputs/annotation.gtf', 'annotation.gtf');
  const featureCountsResult = await runWorkerOnce('../runtime/featurecounts-opfs-worker.mjs', {
    type: 'run',
    samEntryId,
    config: {
      mode: 'se',
      inputs: { annotation },
      options: { threads: 1, strandedness: 0, featureType: 'exon', attribute: 'gene_id' },
    },
  });
  assert(featureCountsResult.exitCode === 0, 'featureCounts OPFS input run failed.');
  const counts = countsProjection(featureCountsResult.outputs['featureCounts.txt']);
  assert(counts.geneId === 'g1' && counts.length === 160 && counts.count === 2,
    'File-backed HISAT2 → featureCounts result differs from the native baseline.');
  return {
    fastp: {
      exitCode: fastpResult.exitCode,
      artifact: fastpResult.outputArtifacts['se.cleaned.fastq.gz'],
      readback: fastpStored,
    },
    hisat2: { exitCode: hisat2Result.exitCode, artifact: hisat2Result.outputArtifact },
    featureCounts: { exitCode: featureCountsResult.exitCode, counts },
    handoff: {
      fullSizeMainThreadCopies: 0,
      fullSizeWorkerTransfers: 0,
      persistedSamCopies: 1,
      descriptorFields: ['schemaVersion', 'entryId'],
    },
  };
}

async function runCancellation(client) {
  const cancelClient = new W3StorageClient();
  let cancellationRequested = false;
  const entryId = `${TEST_PREFIX}cancelled`;
  const request = cancelClient.request('write-synthetic', {
    entryId,
    sizeBytes: 256 * 1024 * 1024,
    chunkBytes: 1024 * 1024,
    headroomBytes: 0,
  }, () => {
    if (!cancellationRequested) {
      cancellationRequested = true;
      cancelClient.close();
    }
  });
  try {
    await request;
    throw new Error('Cancellation unexpectedly completed the 256 MiB write.');
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
  }
  const recovery = await client.request('recover', { prefix: entryId });
  const entries = await client.request('list');
  assert(!entries.some((entry) => entry.entryId === entryId), 'Cancelled artifact was not removed.');
  return {
    requested: cancellationRequested,
    mechanism: 'Worker termination',
    errorName: 'AbortError',
    artifactRemoved: true,
    recovery,
  };
}

async function runSecondLoad(firstLoad) {
  const client = new W3StorageClient();
  const recovery = await client.request('recover', { prefix: TEST_PREFIX });
  assert(recovery.removed.includes(PARTIAL_ENTRY), 'Reload recovery did not delete the partial entry.');
  assert(recovery.retained.includes(LARGE_ENTRY), 'Reload recovery did not retain the committed entry.');
  record('Reload recovery retained ready data and removed the incomplete entry.');

  const monitor = startResponsivenessMonitor();
  const read = await client.request('read-artifact', { entryId: LARGE_ENTRY });
  const responsiveness = monitor.stop();
  assert(read.bytesRead === LARGE_BYTES, 'Cross-Worker read size differs from the committed size.');
  assert(read.checksum === firstLoad.write.checksum, 'Cross-Worker streaming checksum differs.');
  assert(responsiveness.heartbeatCount > 0, 'Main-thread heartbeat did not run during the Worker read.');
  record(`64 MiB OPFS read: ${read.throughputMiBps.toFixed(1)} MiB/s; max chunk ${read.maxReadChunkBytes} bytes.`);

  const impossible = await client.request('estimate', {
    requiredBytes: Math.floor(firstLoad.quota.availableBytes) + 1,
    headroomBytes: 0,
  });
  assert(impossible.allowed === false, 'Insufficient-storage preflight did not reject an impossible reservation.');

  const hosted = await client.request('fetch-to-artifact', {
    entryId: `${TEST_PREFIX}hosted-tiny`,
    url: '../../../test-data/hisat2/native/index/tiny.1.ht2',
    kind: 'hosted-index-part',
    headroomBytes: 0,
  });
  assert(hosted.state.sizeBytes > 0 && hosted.state.persistWriteMaxBytes <= 1024 * 1024,
    'Hosted index fetch was not persisted as bounded chunks.');

  const engines = await runFileBackedEngines(client);
  record(`File-backed engines passed: fastp ${engines.fastp.artifact.sizeBytes} B, SAM ${engines.hisat2.artifact.sizeBytes} B, count ${engines.featureCounts.counts.count}.`);
  const cancellation = await runCancellation(client);
  record('Cancellation removed its partial OPFS artifact.');

  const removedAtEnd = await removePrefix(client);
  const remaining = await client.request('list');
  assert(!remaining.some((entry) => entry.entryId.startsWith(TEST_PREFIX)), 'Final W3 cleanup left test entries behind.');
  client.close();
  return {
    firstLoad,
    recovery,
    read: { ...read, responsiveness },
    insufficientStorage: impossible,
    hostedDownload: hosted,
    engines,
    cancellation,
    cleanup: { removedEntries: removedAtEnd, remainingTestEntries: 0 },
    crossOriginIsolated,
  };
}

window.__w3GateResult = { state: 'running' };
try {
  assert(crossOriginIsolated, 'Cross-origin isolation is unavailable.');
  assert(typeof SharedArrayBuffer === 'function', 'SharedArrayBuffer is unavailable.');
  assert(typeof navigator.storage?.getDirectory === 'function', 'OPFS is unavailable.');
  const saved = sessionStorage.getItem(PHASE_KEY);
  if (!saved) {
    await runFirstLoad();
  } else {
    const firstLoad = JSON.parse(saved);
    const result = await runSecondLoad(firstLoad);
    const summary = {
      browser: {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        crossOriginIsolated,
      },
      write: {
        bytes: result.firstLoad.write.state.sizeBytes,
        elapsedMs: result.firstLoad.write.elapsedMs,
        throughputMiBps: result.firstLoad.write.throughputMiBps,
        maxChunkBytes: result.firstLoad.write.state.maxWriteChunkBytes,
        checksum: result.firstLoad.write.checksum,
        responsiveness: result.firstLoad.responsiveness,
      },
      read: {
        bytes: result.read.bytesRead,
        elapsedMs: result.read.elapsedMs,
        throughputMiBps: result.read.throughputMiBps,
        maxChunkBytes: result.read.maxReadChunkBytes,
        checksum: result.read.checksum,
        responsiveness: result.read.responsiveness,
      },
      quota: result.firstLoad.quota,
      insufficientStorageRejected: result.insufficientStorage.allowed === false,
      recovery: result.recovery,
      hostedDownload: result.hostedDownload.state,
      engines: result.engines,
      cancellation: result.cancellation,
      cleanup: result.cleanup,
    };
    sessionStorage.removeItem(PHASE_KEY);
    window.__w3GateResult = { state: 'passed', ...result };
    outputElement.dataset.result = JSON.stringify(summary);
    record(`RESULT ${JSON.stringify(summary)}`);
    statusElement.dataset.state = 'passed';
    statusElement.textContent = 'Passed: W3 bounded OPFS I/O, reload recovery, cancellation, and file-backed engine handoff.';
    document.title = 'PASS — W3 browser large-file gate';
  }
} catch (error) {
  sessionStorage.removeItem(PHASE_KEY);
  console.error(error);
  record(`FAILED: ${error.stack || error.message || error}`);
  window.__w3GateResult = { state: 'failed', message: error.message || String(error), stack: error.stack || null };
  statusElement.dataset.state = 'failed';
  statusElement.textContent = `Failed: ${error.message || error}`;
  document.title = 'FAIL — W3 browser large-file gate';
}
