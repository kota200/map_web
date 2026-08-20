import {
  estimateStorage,
  finishArtifactWriter,
  getReadyArtifact,
  listEntries,
  openArtifactWriter,
  recoverIncompleteEntries,
  removeEntry,
} from './opfs-artifact-store.mjs';

const activeJobs = new Map();

function post(id, type, payload = {}) {
  self.postMessage({ id, type, ...payload });
}

function cancelledError() {
  return new DOMException('Storage operation stopped by user.', 'AbortError');
}

function ensureNotCancelled(job) {
  if (job.cancelled) throw cancelledError();
}

function nextTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function updateFnv1a(hash, bytes) {
  let value = hash >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    value ^= bytes[index];
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

function hex32(value) {
  return (value >>> 0).toString(16).padStart(8, '0');
}

async function probe() {
  const entryId = `probe-${crypto.randomUUID()}`;
  const writer = await openArtifactWriter(entryId, { kind: 'probe', expectedBytes: 1 });
  writer.write(new Uint8Array([0x57]), 0);
  await finishArtifactWriter(writer, { ready: false });
  return {
    opfs: true,
    syncAccessHandle: true,
    worker: typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope,
    performanceMemory: Number.isFinite(performance?.memory?.usedJSHeapSize),
  };
}

async function writeSynthetic(id, message, job) {
  const sizeBytes = Number(message.sizeBytes);
  const chunkBytes = Number(message.chunkBytes ?? 1024 * 1024);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) throw new RangeError('sizeBytes must be positive.');
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 4096 || chunkBytes > 8 * 1024 * 1024) {
    throw new RangeError('chunkBytes must be between 4 KiB and 8 MiB.');
  }
  const quota = await estimateStorage(sizeBytes, Number(message.headroomBytes ?? 64 * 1024 * 1024));
  if (quota.allowed === false) {
    const error = new Error(`Insufficient browser storage: ${quota.availableBytes} bytes available, ${sizeBytes + quota.headroomBytes} required.`);
    error.name = 'QuotaPreflightError';
    throw error;
  }
  const writer = await openArtifactWriter(message.entryId, {
    kind: message.kind ?? 'synthetic-benchmark',
    expectedBytes: sizeBytes,
  });
  const chunk = new Uint8Array(Math.min(chunkBytes, sizeBytes));
  for (let index = 0; index < chunk.length; index += 1) chunk[index] = (index * 31 + 17) & 0xff;
  let position = 0;
  let hash = 0x811c9dc5;
  const started = performance.now();
  try {
    while (position < sizeBytes) {
      ensureNotCancelled(job);
      const length = Math.min(chunk.length, sizeBytes - position);
      const bytes = length === chunk.length ? chunk : chunk.subarray(0, length);
      writer.write(bytes, position);
      hash = updateFnv1a(hash, bytes);
      position += length;
      if (position === sizeBytes || position % (8 * chunkBytes) === 0) {
        post(id, 'progress', { completedBytes: position, totalBytes: sizeBytes });
      }
      await nextTurn();
    }
    const state = await finishArtifactWriter(writer, {
      ready: true,
      metadata: { generator: 'w3-repeating-byte-pattern-v1', chunkBytes },
    });
    const elapsedMs = performance.now() - started;
    return {
      state,
      checksum: `fnv1a32:${hex32(hash)}`,
      elapsedMs,
      throughputMiBps: (sizeBytes / 1048576) / (elapsedMs / 1000),
      quota,
    };
  } catch (error) {
    await finishArtifactWriter(writer, { ready: false });
    throw error;
  }
}

async function fetchToArtifact(id, message, job) {
  const response = await fetch(message.url, { cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error(`${message.url}: HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length'));
  const expectedBytes = Number.isSafeInteger(contentLength) && contentLength >= 0 ? contentLength : null;
  if (expectedBytes != null) {
    const quota = await estimateStorage(expectedBytes, Number(message.headroomBytes ?? 64 * 1024 * 1024));
    if (quota.allowed === false) {
      const error = new Error(`Insufficient browser storage for download: ${quota.availableBytes} bytes available.`);
      error.name = 'QuotaPreflightError';
      throw error;
    }
  }
  const writer = await openArtifactWriter(message.entryId, { kind: message.kind ?? 'hosted-download', expectedBytes });
  const reader = response.body.getReader();
  let position = 0;
  let sourceChunkMaxBytes = 0;
  const persistChunkBytes = Number(message.chunkBytes ?? 1024 * 1024);
  if (!Number.isSafeInteger(persistChunkBytes) || persistChunkBytes < 4096 || persistChunkBytes > 8 * 1024 * 1024) {
    throw new RangeError('Download chunkBytes must be between 4 KiB and 8 MiB.');
  }
  const started = performance.now();
  try {
    while (true) {
      ensureNotCancelled(job);
      const { done, value } = await reader.read();
      if (done) break;
      sourceChunkMaxBytes = Math.max(sourceChunkMaxBytes, value.byteLength);
      for (let offset = 0; offset < value.byteLength; offset += persistChunkBytes) {
        ensureNotCancelled(job);
        const chunk = value.subarray(offset, Math.min(value.byteLength, offset + persistChunkBytes));
        writer.write(chunk, position);
        position += chunk.byteLength;
      }
      post(id, 'progress', { completedBytes: position, totalBytes: expectedBytes });
    }
    const state = await finishArtifactWriter(writer, {
      ready: true,
      metadata: {
        sourceUrl: new URL(message.url, self.location.href).pathname,
        sourceChunkMaxBytes,
        persistWriteMaxBytes: writer.maxWriteChunkBytes,
      },
    });
    return { state, elapsedMs: performance.now() - started };
  } catch (error) {
    await reader.cancel().catch(() => {});
    await finishArtifactWriter(writer, { ready: false });
    throw error;
  }
}

async function readArtifact(id, message, job) {
  const { file, state } = await getReadyArtifact(message.entryId);
  const reader = file.stream().getReader();
  let bytesRead = 0;
  let maxReadChunkBytes = 0;
  let hash = 0x811c9dc5;
  const started = performance.now();
  while (true) {
    ensureNotCancelled(job);
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    maxReadChunkBytes = Math.max(maxReadChunkBytes, value.byteLength);
    hash = updateFnv1a(hash, value);
    if (bytesRead === file.size || bytesRead % (8 * 1024 * 1024) === 0) {
      post(id, 'progress', { completedBytes: bytesRead, totalBytes: file.size });
    }
    await nextTurn();
  }
  const elapsedMs = performance.now() - started;
  return {
    state,
    bytesRead,
    maxReadChunkBytes,
    checksum: `fnv1a32:${hex32(hash)}`,
    elapsedMs,
    throughputMiBps: (bytesRead / 1048576) / (elapsedMs / 1000),
  };
}

async function createPartial(message) {
  const writer = await openArtifactWriter(message.entryId, { kind: 'intentional-partial' });
  writer.write(new Uint8Array(Number(message.sizeBytes ?? 1024 * 1024)), 0);
  writer.close();
  return { entryId: message.entryId, sizeBytes: writer.bytesWritten, ready: false };
}

async function getArtifactFile(message) {
  const { file, state, descriptor } = await getReadyArtifact(message.entryId);
  return { file, state, descriptor };
}

async function dispatch(id, message, job) {
  switch (message.op) {
    case 'probe': return probe();
    case 'estimate': return estimateStorage(Number(message.requiredBytes ?? 0), Number(message.headroomBytes ?? 64 * 1024 * 1024));
    case 'write-synthetic': return writeSynthetic(id, message, job);
    case 'fetch-to-artifact': return fetchToArtifact(id, message, job);
    case 'read-artifact': return readArtifact(id, message, job);
    case 'create-partial': return createPartial(message);
    case 'get-file': return getArtifactFile(message);
    case 'recover': return recoverIncompleteEntries({ prefix: message.prefix ?? '' });
    case 'list': return listEntries();
    case 'remove': return { entryId: message.entryId, removed: await removeEntry(message.entryId) };
    default: throw new Error(`Unknown W3 storage operation: ${message.op}`);
  }
}

self.onmessage = (event) => {
  const message = event.data;
  if (message?.op === 'cancel') {
    const job = activeJobs.get(message.targetId);
    if (job) job.cancelled = true;
    post(message.id, 'result', { result: { targetId: message.targetId, acknowledged: Boolean(job) } });
    return;
  }
  if (!message?.id) return;
  const job = { cancelled: false };
  activeJobs.set(message.id, job);
  Promise.resolve(dispatch(message.id, message, job)).then(
    (result) => post(message.id, 'result', { result }),
    (error) => post(message.id, 'error', {
      name: error?.name || 'Error',
      message: error?.message || String(error),
      stack: error?.stack || null,
    }),
  ).finally(() => activeJobs.delete(message.id));
};
