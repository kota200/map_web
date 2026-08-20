import { validateIndexReference } from '../../../js/index-catalog.mjs';
import { IncrementalSha256, sha256File } from './sha256-incremental.mjs';

const ROOT_NAME = 'kallisto-web-index-cache-v1';
const ENTRIES_NAME = 'entries';
const FILES_NAME = 'files';
const READY_NAME = 'ready.json';
const PARTIAL_NAME = 'partial.json';
const SCHEMA_VERSION = 1;
const DEFAULT_CHUNK_BYTES = 1024 * 1024;
const DEFAULT_HEADROOM_BYTES = 64 * 1024 * 1024;

export class IntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IntegrityError';
  }
}

function storageManager() {
  const storage = globalThis.navigator?.storage;
  if (!storage || typeof storage.getDirectory !== 'function') throw new Error('OPFS is unavailable.');
  return storage;
}

function requireSafeName(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,160}$/.test(value)) throw new TypeError(`${label} is unsafe.`);
  return value;
}

async function rootDirectory() {
  const root = await storageManager().getDirectory();
  const app = await root.getDirectoryHandle(ROOT_NAME, { create: true });
  return app.getDirectoryHandle(ENTRIES_NAME, { create: true });
}

async function entryDirectory(cacheKey, create = false) {
  requireSafeName(cacheKey, 'cacheKey');
  return (await rootDirectory()).getDirectoryHandle(cacheKey, { create });
}

async function removeIfPresent(directory, name, options = {}) {
  try {
    await directory.removeEntry(name, options);
    return true;
  } catch (error) {
    if (error?.name === 'NotFoundError') return false;
    throw error;
  }
}

async function writeJson(directory, name, value) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify(value, null, 2));
  } finally {
    await writable.close();
  }
}

async function readJson(directory, name) {
  const handle = await directory.getFileHandle(name);
  return JSON.parse(await (await handle.getFile()).text());
}

async function directorySize(directory) {
  let size = 0;
  for await (const handle of directory.values()) {
    if (handle.kind === 'file') size += (await handle.getFile()).size;
    else size += await directorySize(handle);
  }
  return size;
}

function allArtifacts(reference) {
  return [...reference.files, reference.annotation];
}

function normalizeReference(reference) {
  return validateIndexReference(reference, { allowComputedTotal: 'total_size' in reference });
}

export async function computeReferenceCacheKey(referenceInput) {
  const reference = normalizeReference(referenceInput);
  const material = JSON.stringify({
    id: reference.id,
    hisat2Version: reference.hisat2_version,
    files: reference.files.map(({ name, sha256 }) => ({ name, sha256 })),
    annotation: { name: reference.annotation.name, sha256: reference.annotation.sha256 },
  });
  const hash = new IncrementalSha256().update(new TextEncoder().encode(material)).digestHex();
  return `${reference.id}-${hash}`;
}

export async function estimateReferenceStorage(referenceInput, headroomBytes = DEFAULT_HEADROOM_BYTES) {
  const reference = normalizeReference(referenceInput);
  if (!Number.isSafeInteger(headroomBytes) || headroomBytes < 0) throw new RangeError('headroomBytes is invalid.');
  const estimate = typeof storageManager().estimate === 'function' ? await storageManager().estimate() : {};
  const quotaBytes = Number.isFinite(estimate.quota) ? Number(estimate.quota) : null;
  const usageBytes = Number.isFinite(estimate.usage) ? Number(estimate.usage) : null;
  const availableBytes = quotaBytes != null && usageBytes != null ? Math.max(0, quotaBytes - usageBytes) : null;
  return {
    requiredBytes: reference.total_size,
    headroomBytes,
    quotaBytes,
    usageBytes,
    availableBytes,
    allowed: availableBytes == null ? null : reference.total_size + headroomBytes <= availableBytes,
  };
}

export async function estimateArbitraryStorage(requiredBytes, headroomBytes = 0) {
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) throw new RangeError('requiredBytes is invalid.');
  if (!Number.isSafeInteger(headroomBytes) || headroomBytes < 0) throw new RangeError('headroomBytes is invalid.');
  const estimate = typeof storageManager().estimate === 'function' ? await storageManager().estimate() : {};
  const quotaBytes = Number.isFinite(estimate.quota) ? Number(estimate.quota) : null;
  const usageBytes = Number.isFinite(estimate.usage) ? Number(estimate.usage) : null;
  const availableBytes = quotaBytes != null && usageBytes != null ? Math.max(0, quotaBytes - usageBytes) : null;
  return { requiredBytes, headroomBytes, quotaBytes, usageBytes, availableBytes, allowed: availableBytes == null ? null : requiredBytes + headroomBytes <= availableBytes };
}

async function downloadArtifact(artifact, filesDirectory, {
  onProgress,
  progressState,
  chunkBytes,
  testChunkDelayMs,
}) {
  const response = await fetch(artifact.url, { cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error(`${artifact.name}: HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isSafeInteger(contentLength) && contentLength >= 0 && contentLength !== artifact.size) {
    throw new IntegrityError(`${artifact.name}: HTTP Content-Length ${contentLength} differs from catalog size ${artifact.size}.`);
  }
  const fileHandle = await filesDirectory.getFileHandle(artifact.name, { create: true });
  const access = await fileHandle.createSyncAccessHandle();
  access.truncate(0);
  const reader = response.body.getReader();
  const hasher = new IncrementalSha256();
  let position = 0;
  let sourceChunkMaxBytes = 0;
  let persistWriteMaxBytes = 0;
  let writeCalls = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sourceChunkMaxBytes = Math.max(sourceChunkMaxBytes, value.byteLength);
      hasher.update(value);
      for (let offset = 0; offset < value.byteLength; offset += chunkBytes) {
        const chunk = value.subarray(offset, Math.min(value.byteLength, offset + chunkBytes));
        const written = access.write(chunk, { at: position });
        if (written !== chunk.byteLength) throw new Error(`${artifact.name}: partial OPFS write.`);
        position += written;
        progressState.completedBytes += written;
        persistWriteMaxBytes = Math.max(persistWriteMaxBytes, written);
        writeCalls += 1;
        onProgress?.({
          stage: 'download',
          file: artifact.name,
          fileCompletedBytes: position,
          fileTotalBytes: artifact.size,
          completedBytes: progressState.completedBytes,
          totalBytes: progressState.totalBytes,
        });
        if (testChunkDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, testChunkDelayMs));
      }
    }
    access.flush();
  } finally {
    access.close();
  }
  const sha256 = hasher.digestHex();
  if (position !== artifact.size) throw new IntegrityError(`${artifact.name}: received ${position} bytes, expected ${artifact.size}.`);
  if (sha256 !== artifact.sha256) throw new IntegrityError(`${artifact.name}: SHA-256 mismatch.`);
  return { name: artifact.name, size: position, sha256, sourceChunkMaxBytes, persistWriteMaxBytes, writeCalls };
}

async function scanAnnotationContigs(file) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  const contigs = new Set();
  let pending = '';
  const consume = (line) => {
    if (!line || line.startsWith('#')) return;
    const separator = line.indexOf('\t');
    if (separator > 0) contigs.add(line.slice(0, separator));
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) consume(line);
  }
  pending += decoder.decode();
  consume(pending);
  return [...contigs].sort();
}

async function validateCachedAnnotationContigs(reference, filesDirectory) {
  const file = await (await filesDirectory.getFileHandle(reference.annotation.name)).getFile();
  const observed = await scanAnnotationContigs(file);
  const referenceNames = new Set(reference.contigs.map((contig) => contig.name));
  const expectedAnnotation = new Set(reference.annotation.contigs);
  for (const contig of observed) {
    if (!referenceNames.has(contig)) throw new IntegrityError(`Annotation contig ${contig} is absent from the reference manifest.`);
  }
  for (const contig of expectedAnnotation) {
    if (!observed.includes(contig)) throw new IntegrityError(`Declared annotation contig ${contig} was not found in the annotation file.`);
  }
  return { observed, compatible: true };
}

export async function downloadReference(referenceInput, {
  onProgress = null,
  headroomBytes = DEFAULT_HEADROOM_BYTES,
  chunkBytes = DEFAULT_CHUNK_BYTES,
  testChunkDelayMs = 0,
} = {}) {
  const reference = normalizeReference(referenceInput);
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 4096 || chunkBytes > 8 * 1024 * 1024) throw new RangeError('chunkBytes is invalid.');
  if (!Number.isSafeInteger(testChunkDelayMs) || testChunkDelayMs < 0 || testChunkDelayMs > 100 || (testChunkDelayMs > 0 && !reference.test_only)) {
    throw new Error('Artificial download delay is allowed only for test references.');
  }
  const estimate = await estimateReferenceStorage(reference, headroomBytes);
  if (estimate.allowed === false) {
    const error = new Error(`Insufficient storage: ${estimate.availableBytes} bytes available, ${reference.total_size + headroomBytes} required.`);
    error.name = 'QuotaPreflightError';
    throw error;
  }
  const cacheKey = await computeReferenceCacheKey(reference);
  try {
    const ready = await verifyCachedReference(reference, { verifyHashes: true, onProgress });
    return { ...ready, alreadyReady: true, estimate };
  } catch {
    await deleteCachedReference(cacheKey);
  }
  const directory = await entryDirectory(cacheKey, true);
  const filesDirectory = await directory.getDirectoryHandle(FILES_NAME, { create: true });
  await writeJson(directory, PARTIAL_NAME, {
    schemaVersion: SCHEMA_VERSION,
    status: 'downloading',
    cacheKey,
    referenceId: reference.id,
    expectedBytes: reference.total_size,
    startedAt: new Date().toISOString(),
  });
  onProgress?.({ stage: 'prepared', completedBytes: 0, totalBytes: reference.total_size, cacheKey });
  const progressState = { completedBytes: 0, totalBytes: reference.total_size };
  const records = [];
  try {
    for (const artifact of allArtifacts(reference)) {
      records.push(await downloadArtifact(artifact, filesDirectory, { onProgress, progressState, chunkBytes, testChunkDelayMs }));
    }
    const contigValidation = await validateCachedAnnotationContigs(reference, filesDirectory);
    const ready = {
      schemaVersion: SCHEMA_VERSION,
      status: 'ready',
      cacheKey,
      referenceId: reference.id,
      hisat2Version: reference.hisat2_version,
      assembly: reference.assembly,
      annotationVersion: reference.annotation.version,
      totalSize: reference.total_size,
      files: records,
      contigValidation,
      completedAt: new Date().toISOString(),
    };
    await writeJson(directory, READY_NAME, ready);
    await removeIfPresent(directory, PARTIAL_NAME);
    return { cacheKey, ready, estimate, alreadyReady: false };
  } catch (error) {
    await deleteCachedReference(cacheKey);
    throw error;
  }
}

export async function verifyCachedReference(referenceInput, { verifyHashes = true, onProgress = null } = {}) {
  const reference = normalizeReference(referenceInput);
  const cacheKey = await computeReferenceCacheKey(reference);
  const directory = await entryDirectory(cacheKey, false);
  const ready = await readJson(directory, READY_NAME);
  if (ready?.schemaVersion !== SCHEMA_VERSION || ready?.status !== 'ready' || ready.cacheKey !== cacheKey || ready.referenceId !== reference.id) {
    throw new IntegrityError('Cache ready manifest is invalid.');
  }
  const expectedArtifacts = allArtifacts(reference);
  if (ready.hisat2Version !== reference.hisat2_version || ready.assembly !== reference.assembly || ready.totalSize !== reference.total_size || !Array.isArray(ready.files) || ready.files.length !== expectedArtifacts.length) {
    throw new IntegrityError('Cache ready manifest metadata differs from the reference manifest.');
  }
  for (const artifact of expectedArtifacts) {
    const record = ready.files.find((candidate) => candidate?.name === artifact.name);
    if (!record || record.size !== artifact.size || record.sha256 !== artifact.sha256) throw new IntegrityError(`${artifact.name}: ready manifest record mismatch.`);
  }
  const filesDirectory = await directory.getDirectoryHandle(FILES_NAME);
  const verified = [];
  let completedBytes = 0;
  for (const artifact of expectedArtifacts) {
    const file = await (await filesDirectory.getFileHandle(artifact.name)).getFile();
    if (file.size !== artifact.size) throw new IntegrityError(`${artifact.name}: cached size mismatch.`);
    let sha256 = artifact.sha256;
    let maxChunkBytes = 0;
    if (verifyHashes) {
      const result = await sha256File(file, { onChunk({ bytesRead, chunkBytes: currentChunk }) {
        maxChunkBytes = Math.max(maxChunkBytes, currentChunk);
        onProgress?.({ stage: 'verify', file: artifact.name, fileCompletedBytes: bytesRead, fileTotalBytes: artifact.size, completedBytes: completedBytes + bytesRead, totalBytes: reference.total_size });
      } });
      sha256 = result.sha256;
      if (sha256 !== artifact.sha256) throw new IntegrityError(`${artifact.name}: cached SHA-256 mismatch.`);
    }
    completedBytes += artifact.size;
    verified.push({ name: artifact.name, size: file.size, sha256, maxChunkBytes });
  }
  const contigValidation = await validateCachedAnnotationContigs(reference, filesDirectory);
  return { cacheKey, ready, verified, contigValidation };
}

export async function getCachedReferenceFiles(referenceInput) {
  const reference = normalizeReference(referenceInput);
  const verification = await verifyCachedReference(reference, { verifyHashes: false });
  const directory = await entryDirectory(verification.cacheKey, false);
  const filesDirectory = await directory.getDirectoryHandle(FILES_NAME);
  const files = {};
  for (const artifact of allArtifacts(reference)) files[artifact.name] = await (await filesDirectory.getFileHandle(artifact.name)).getFile();
  return { ...verification, files };
}

export async function deleteCachedReference(cacheKey) {
  requireSafeName(cacheKey, 'cacheKey');
  const entries = await rootDirectory();
  let freedBytes = 0;
  try {
    freedBytes = await directorySize(await entries.getDirectoryHandle(cacheKey));
  } catch (error) {
    if (error?.name !== 'NotFoundError') throw error;
  }
  const removed = await removeIfPresent(entries, cacheKey, { recursive: true });
  return { cacheKey, removed, freedBytes };
}

export async function listCachedReferences() {
  const entries = await rootDirectory();
  const result = [];
  for await (const [cacheKey, handle] of entries.entries()) {
    if (handle.kind !== 'directory') continue;
    const sizeBytes = await directorySize(handle);
    try {
      const ready = await readJson(handle, READY_NAME);
      if (ready?.schemaVersion !== SCHEMA_VERSION || ready?.status !== 'ready' || ready.cacheKey !== cacheKey) throw new Error('invalid ready marker');
      result.push({ cacheKey, status: 'ready', referenceId: ready.referenceId, sizeBytes });
    } catch (error) {
      result.push({ cacheKey, status: 'partial-or-invalid', sizeBytes, error: error?.message || String(error) });
    }
  }
  return result.sort((left, right) => left.cacheKey.localeCompare(right.cacheKey));
}

export async function recoverIncompleteCaches() {
  const entries = await listCachedReferences();
  const removed = [];
  const retained = [];
  for (const entry of entries) {
    if (entry.status === 'ready') retained.push(entry.cacheKey);
    else {
      await deleteCachedReference(entry.cacheKey);
      removed.push(entry.cacheKey);
    }
  }
  return { removed, retained };
}

export const INDEX_CACHE_LAYOUT = Object.freeze({ rootName: ROOT_NAME, entriesName: ENTRIES_NAME, filesName: FILES_NAME, readyName: READY_NAME, schemaVersion: SCHEMA_VERSION });
