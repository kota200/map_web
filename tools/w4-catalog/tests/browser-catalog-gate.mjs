import { loadConfiguredCatalog, validateIndexCatalog } from '../../../js/index-catalog.mjs';
import { W4IndexCacheClient } from '../runtime/cache-client.mjs';

const PHASE_KEY = 'kallisto-web-w4-catalog-gate-v1';
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function monitorMainThread() {
  let last = performance.now();
  let heartbeatCount = 0;
  let maxHeartbeatGapMs = 0;
  const longTasks = [];
  const interval = setInterval(() => {
    const now = performance.now();
    heartbeatCount += 1;
    maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - last);
    last = now;
  }, 16);
  let observer = null;
  if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({ entryTypes: ['longtask'] });
  }
  return {
    stop() {
      clearInterval(interval);
      observer?.disconnect();
      return { heartbeatCount, maxHeartbeatGapMs, longTasks };
    },
  };
}

async function runWorkerOnce(relativeUrl, message) {
  const worker = new Worker(new URL(relativeUrl, import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error(`${relativeUrl} timed out.`));
    }, 120000);
    worker.onmessage = (event) => {
      const data = event.data;
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

async function cleanupReferenceEntries(client, referenceId) {
  const entries = await client.request('list');
  const targets = entries.filter((entry) => entry.cacheKey.startsWith(`${referenceId}-`));
  for (const entry of targets) await client.request('delete', { cacheKey: entry.cacheKey });
  return targets.map((entry) => entry.cacheKey);
}

async function loadFixture() {
  const { config, catalog } = await loadConfiguredCatalog();
  assert(config.environment === 'local-test', 'W4 fixture must be explicitly configured as local-test.');
  assert(config.production_configured === false, 'Local W4 fixture must not claim a production catalog.');
  assert(catalog.references.length === 1, 'W4 fixture must contain one reference.');
  const reference = catalog.references[0];
  assert(reference.files.length === 8, 'HISAT2 reference does not have exactly eight parts.');
  assert(reference.total_size === 4203807, 'Catalog total size differs from the audited fixture.');
  assert(reference.contigs.length === 1 && reference.contigs[0].name === 'chrTiny', 'Reference contig declaration is invalid.');
  assert(reference.annotation.contigs.length === 1 && reference.annotation.contigs[0] === 'chrTiny', 'Annotation contig declaration is invalid.');

  const missingPart = structuredClone({ schema_version: 1, references: [reference] });
  delete missingPart.references[0].total_size;
  missingPart.references[0].files.pop();
  assertThrows(() => validateIndexCatalog(missingPart), 'A seven-part HISAT2 manifest was accepted.');
  const incompatible = structuredClone({ schema_version: 1, references: [reference] });
  delete incompatible.references[0].total_size;
  incompatible.references[0].annotation.contigs = ['chrMissing'];
  assertThrows(() => validateIndexCatalog(incompatible), 'An incompatible annotation contig was accepted.');
  return { config, catalog, reference };
}

function assertThrows(callback, message) {
  let threw = false;
  try { callback(); } catch { threw = true; }
  assert(threw, message);
}

async function firstLoad(reference, config) {
  const housekeeping = new W4IndexCacheClient();
  await cleanupReferenceEntries(housekeeping, reference.id);
  const { cacheKey } = await housekeeping.request('cache-key', { reference });
  const estimate = await housekeeping.request('estimate-reference', { reference, headroomBytes: 0 });
  assert(Number.isFinite(estimate.availableBytes), 'Browser storage quota is unavailable.');
  assert(estimate.allowed === true, 'The tiny hosted reference does not fit in OPFS.');
  const impossible = await housekeeping.request('estimate', { requiredBytes: Math.floor(estimate.availableBytes) + 1, headroomBytes: 0 });
  assert(impossible.allowed === false, 'Quota preflight accepted an impossible reservation.');
  housekeeping.close();

  const cancelClient = new W4IndexCacheClient();
  let cancellationRequested = false;
  const cancelled = cancelClient.request('download', {
    reference,
    headroomBytes: 0,
    chunkBytes: 256 * 1024,
    testChunkDelayMs: 25,
  }, (progress) => {
    if (!cancellationRequested && progress.stage === 'download' && progress.completedBytes > 0) {
      cancellationRequested = true;
      cancelClient.close();
    }
  });
  let cancellationError = null;
  try { await cancelled; } catch (error) { cancellationError = error; }
  assert(cancellationRequested && cancellationError?.name === 'AbortError', 'Worker-termination cancellation did not abort the download.');
  await sleep(75);

  const client = new W4IndexCacheClient();
  const recovery = await client.request('recover');
  assert(recovery.removed.includes(cacheKey), 'Recovery did not delete the interrupted partial cache.');
  const monitor = monitorMainThread();
  const started = performance.now();
  const download = await client.request('download', {
    reference,
    headroomBytes: 0,
    chunkBytes: 1024 * 1024,
    testChunkDelayMs: 2,
  });
  const elapsedMs = performance.now() - started;
  const responsiveness = monitor.stop();
  assert(download.ready.status === 'ready', 'Retry did not publish a ready marker.');
  assert(download.ready.files.length === 9, 'Ready marker does not cover all index and annotation artifacts.');
  assert(download.ready.contigValidation.compatible === true, 'Downloaded annotation contigs are incompatible.');
  assert(Math.max(...download.ready.files.map((file) => file.persistWriteMaxBytes)) <= 1024 * 1024, 'OPFS write exceeded its bounded chunk size.');
  assert(responsiveness.heartbeatCount > 0, 'Main-thread heartbeat did not run during hosted download.');
  client.close();

  const state = {
    config,
    cacheKey,
    estimate,
    impossible,
    cancellation: { requested: cancellationRequested, errorName: cancellationError.name, recovery },
    download: { elapsedMs, ready: download.ready, responsiveness },
  };
  sessionStorage.setItem(PHASE_KEY, JSON.stringify(state));
  statusElement.textContent = 'Reloading to verify the committed multi-file cache…';
  location.reload();
}

async function secondLoad(reference, first) {
  const client = new W4IndexCacheClient();
  const recovery = await client.request('recover');
  assert(recovery.retained.includes(first.cacheKey), 'Reload recovery did not retain the committed reference.');
  assert(!recovery.removed.includes(first.cacheKey), 'Reload recovery treated the ready reference as partial.');

  const verifyMonitor = monitorMainThread();
  const verified = await client.request('verify', { reference, verifyHashes: true });
  const verifyResponsiveness = verifyMonitor.stop();
  assert(verified.verified.length === 9, 'Reload verification did not hash all nine artifacts.');
  assert(verified.verified.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)), 'Reload verification returned an invalid checksum.');
  assert(verified.contigValidation.compatible === true && verified.contigValidation.observed.includes('chrTiny'), 'Reload annotation compatibility check failed.');

  const corruption = await runWorkerOnce('./corrupt-cache-worker.mjs', { reference, fileName: 'tiny.2.ht2' });
  let corruptError = null;
  try { await client.request('verify', { reference, verifyHashes: true, invalidateOnFailure: true }); } catch (error) { corruptError = error; }
  assert(corruptError?.name === 'IntegrityError', 'Same-size cache corruption was not detected by SHA-256.');
  assert(corruptError.cleanup?.removed === true, 'Corrupt reference cache was not deleted automatically.');
  const afterCorruption = await client.request('list');
  assert(!afterCorruption.some((entry) => entry.cacheKey === first.cacheKey), 'Corrupt cache remains after invalidation.');

  const badReference = structuredClone(reference);
  badReference.files[0].sha256 = `${badReference.files[0].sha256.slice(0, -1)}${badReference.files[0].sha256.endsWith('0') ? '1' : '0'}`;
  const { cacheKey: badCacheKey } = await client.request('cache-key', { reference: badReference });
  assert(badCacheKey !== first.cacheKey, 'Cache key does not include every file checksum.');
  let badManifestError = null;
  try { await client.request('download', { reference: badReference, headroomBytes: 0 }); } catch (error) { badManifestError = error; }
  assert(badManifestError?.name === 'IntegrityError', 'A catalog/file SHA-256 mismatch was not rejected.');
  const afterBadManifest = await client.request('list');
  assert(!afterBadManifest.some((entry) => entry.cacheKey === badCacheKey), 'Failed checksum download left a cache entry.');

  const retry = await client.request('download', { reference, headroomBytes: 0 });
  assert(retry.ready.status === 'ready', 'Valid retry after integrity failure did not recover.');
  const entries = await client.request('list');
  const entry = entries.find((candidate) => candidate.cacheKey === first.cacheKey);
  assert(entry?.status === 'ready' && entry.sizeBytes >= reference.total_size, 'Cache usage listing is incomplete.');
  const deletion = await client.request('delete', { cacheKey: first.cacheKey });
  assert(deletion.removed && deletion.freedBytes >= reference.total_size, 'Explicit cache deletion did not report freed storage.');
  const remaining = await client.request('list');
  assert(!remaining.some((candidate) => candidate.cacheKey.startsWith(`${reference.id}-`)), 'W4 cleanup left reference cache data behind.');
  client.close();
  return {
    reloadRecovery: recovery,
    verification: {
      files: verified.verified.length,
      maxReadChunkBytes: Math.max(...verified.verified.map((file) => file.maxChunkBytes)),
      contigs: verified.contigValidation.observed,
      responsiveness: verifyResponsiveness,
    },
    corruption: { ...corruption, errorName: corruptError.name, removed: corruptError.cleanup.removed },
    catalogMismatch: { cacheKeyChanged: badCacheKey !== first.cacheKey, errorName: badManifestError.name, partialRemoved: true },
    cacheUsage: entry,
    deletion,
    remainingReferenceEntries: 0,
  };
}

window.__w4CatalogGateResult = { state: 'running' };
try {
  assert(crossOriginIsolated, 'Cross-origin isolation is unavailable.');
  assert(typeof navigator.storage?.getDirectory === 'function', 'OPFS is unavailable.');
  const { config, reference } = await loadFixture();
  record(`Catalog: ${reference.id}; ${reference.total_size} bytes; ${reference.hisat2_version}.`);
  const saved = sessionStorage.getItem(PHASE_KEY);
  if (!saved) {
    await firstLoad(reference, config);
  } else {
    const first = JSON.parse(saved);
    const second = await secondLoad(reference, first);
    const summary = {
      browser: { userAgent: navigator.userAgent, crossOriginIsolated },
      catalog: {
        environment: config.environment,
        productionConfigured: config.production_configured,
        referenceId: reference.id,
        hisat2Version: reference.hisat2_version,
        artifacts: reference.files.length + 1,
        totalBytes: reference.total_size,
      },
      cacheKey: first.cacheKey,
      quota: first.estimate,
      impossibleStorageRejected: first.impossible.allowed === false,
      cancellation: first.cancellation,
      initialDownload: first.download,
      ...second,
    };
    sessionStorage.removeItem(PHASE_KEY);
    window.__w4CatalogGateResult = { state: 'passed', summary };
    outputElement.dataset.result = JSON.stringify(summary);
    record(`RESULT ${JSON.stringify(summary)}`);
    statusElement.dataset.state = 'passed';
    statusElement.textContent = 'Passed: W4 manifest integrity, multi-file OPFS cache, reload, recovery, and deletion.';
    document.title = 'PASS — W4 hosted index catalog gate';
  }
} catch (error) {
  sessionStorage.removeItem(PHASE_KEY);
  console.error(error);
  record(`FAILED: ${error.stack || error.message || error}`);
  window.__w4CatalogGateResult = { state: 'failed', message: error.message || String(error), stack: error.stack || null };
  statusElement.dataset.state = 'failed';
  statusElement.textContent = `Failed: ${error.message || error}`;
  document.title = 'FAIL — W4 hosted index catalog gate';
}
