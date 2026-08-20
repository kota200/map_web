const ROOT_NAME = 'kallisto-web-w3';
const ENTRIES_NAME = 'entries';
const DATA_NAME = 'payload.data';
const STATE_NAME = 'state.json';
const SCHEMA_VERSION = 1;
const DEFAULT_HEADROOM_BYTES = 64 * 1024 * 1024;

function requireSafeSegment(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,160}$/.test(value)) {
    throw new TypeError(`${label} must contain only letters, numbers, dot, underscore, or dash.`);
  }
  return value;
}

function storageManager() {
  const storage = globalThis.navigator?.storage;
  if (!storage || typeof storage.getDirectory !== 'function') {
    throw new Error('OPFS is unavailable in this browser context.');
  }
  return storage;
}

async function entriesDirectory() {
  const root = await storageManager().getDirectory();
  const app = await root.getDirectoryHandle(ROOT_NAME, { create: true });
  return app.getDirectoryHandle(ENTRIES_NAME, { create: true });
}

async function entryDirectory(entryId, create = false) {
  requireSafeSegment(entryId, 'entryId');
  return (await entriesDirectory()).getDirectoryHandle(entryId, { create });
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
  const file = await handle.getFile();
  return JSON.parse(await file.text());
}

export async function estimateStorage(requiredBytes = 0, headroomBytes = DEFAULT_HEADROOM_BYTES) {
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) {
    throw new RangeError('requiredBytes must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(headroomBytes) || headroomBytes < 0) {
    throw new RangeError('headroomBytes must be a non-negative safe integer.');
  }
  const storage = storageManager();
  const estimate = typeof storage.estimate === 'function' ? await storage.estimate() : {};
  const quotaBytes = Number.isFinite(estimate.quota) ? Number(estimate.quota) : null;
  const usageBytes = Number.isFinite(estimate.usage) ? Number(estimate.usage) : null;
  const availableBytes = quotaBytes != null && usageBytes != null
    ? Math.max(0, quotaBytes - usageBytes)
    : null;
  return {
    requiredBytes,
    headroomBytes,
    quotaBytes,
    usageBytes,
    availableBytes,
    allowed: availableBytes == null ? null : requiredBytes + headroomBytes <= availableBytes,
  };
}

export async function openArtifactWriter(entryId, { kind = 'temporary', expectedBytes = null } = {}) {
  requireSafeSegment(entryId, 'entryId');
  requireSafeSegment(kind, 'kind');
  if (expectedBytes != null && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0)) {
    throw new RangeError('expectedBytes must be null or a non-negative safe integer.');
  }
  const directory = await entryDirectory(entryId, true);
  await removeIfPresent(directory, STATE_NAME);
  const dataHandle = await directory.getFileHandle(DATA_NAME, { create: true });
  if (typeof dataHandle.createSyncAccessHandle !== 'function') {
    throw new Error('OPFS synchronous access handles are unavailable in this Worker.');
  }
  const accessHandle = await dataHandle.createSyncAccessHandle();
  accessHandle.truncate(0);
  return {
    entryId,
    kind,
    expectedBytes,
    directory,
    dataHandle,
    accessHandle,
    bytesWritten: 0,
    maxWriteChunkBytes: 0,
    writeCalls: 0,
    closed: false,
    write(bytes, position) {
      if (this.closed) throw new Error('Cannot write a closed OPFS artifact.');
      if (!ArrayBuffer.isView(bytes)) throw new TypeError('OPFS writes require an ArrayBuffer view.');
      if (!Number.isSafeInteger(position) || position < 0) throw new RangeError('Invalid OPFS write position.');
      const view = bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const written = this.accessHandle.write(view, { at: position });
      this.bytesWritten = Math.max(this.bytesWritten, position + written);
      this.maxWriteChunkBytes = Math.max(this.maxWriteChunkBytes, written);
      this.writeCalls += 1;
      return written;
    },
    size() {
      return this.accessHandle.getSize();
    },
    flush() {
      if (!this.closed) this.accessHandle.flush();
    },
    close() {
      if (this.closed) return;
      this.accessHandle.flush();
      this.accessHandle.close();
      this.closed = true;
    },
  };
}

export async function finishArtifactWriter(writer, { ready, metadata = {} } = {}) {
  if (!writer || typeof writer.close !== 'function') throw new TypeError('Invalid OPFS artifact writer.');
  writer.close();
  if (!ready) {
    await removeEntry(writer.entryId);
    return { entryId: writer.entryId, ready: false, removed: true };
  }
  const file = await writer.dataHandle.getFile();
  if (writer.expectedBytes != null && file.size !== writer.expectedBytes) {
    await removeEntry(writer.entryId);
    throw new Error(`OPFS artifact size mismatch: expected ${writer.expectedBytes}, received ${file.size}.`);
  }
  const state = {
    schemaVersion: SCHEMA_VERSION,
    status: 'ready',
    entryId: writer.entryId,
    kind: writer.kind,
    sizeBytes: file.size,
    createdAt: new Date().toISOString(),
    writeCalls: writer.writeCalls,
    maxWriteChunkBytes: writer.maxWriteChunkBytes,
    ...metadata,
  };
  await writeJson(writer.directory, STATE_NAME, state);
  return state;
}

export async function getReadyArtifact(entryId) {
  const directory = await entryDirectory(entryId, false);
  const state = await readJson(directory, STATE_NAME);
  if (state?.schemaVersion !== SCHEMA_VERSION || state?.status !== 'ready' || state?.entryId !== entryId) {
    throw new Error(`OPFS entry ${entryId} has no valid ready marker.`);
  }
  const handle = await directory.getFileHandle(DATA_NAME);
  const file = await handle.getFile();
  if (file.size !== state.sizeBytes) {
    throw new Error(`OPFS entry ${entryId} failed its persisted size check.`);
  }
  return { descriptor: { schemaVersion: SCHEMA_VERSION, entryId }, state, file };
}

export async function removeEntry(entryId) {
  requireSafeSegment(entryId, 'entryId');
  return removeIfPresent(await entriesDirectory(), entryId, { recursive: true });
}

export async function listEntries() {
  const entries = await entriesDirectory();
  const result = [];
  for await (const [entryId, handle] of entries.entries()) {
    if (handle.kind !== 'directory') continue;
    try {
      const { state, file } = await getReadyArtifact(entryId);
      result.push({ entryId, status: 'ready', sizeBytes: file.size, kind: state.kind });
    } catch (error) {
      result.push({ entryId, status: 'partial-or-invalid', error: error?.message || String(error) });
    }
  }
  return result.sort((left, right) => left.entryId.localeCompare(right.entryId));
}

export async function recoverIncompleteEntries({ prefix = '' } = {}) {
  if (typeof prefix !== 'string') throw new TypeError('prefix must be a string.');
  const entries = await listEntries();
  const removed = [];
  const retained = [];
  for (const entry of entries) {
    if (!entry.entryId.startsWith(prefix)) continue;
    if (entry.status === 'ready') retained.push(entry.entryId);
    else {
      await removeEntry(entry.entryId);
      removed.push(entry.entryId);
    }
  }
  return { removed, retained };
}

export const OPFS_ARTIFACT_CONSTANTS = Object.freeze({
  rootName: ROOT_NAME,
  schemaVersion: SCHEMA_VERSION,
  defaultHeadroomBytes: DEFAULT_HEADROOM_BYTES,
});
