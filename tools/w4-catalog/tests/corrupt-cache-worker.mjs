import { computeReferenceCacheKey, INDEX_CACHE_LAYOUT } from '../runtime/index-cache.mjs';

self.onmessage = async (event) => {
  try {
    const { reference, fileName } = event.data || {};
    const cacheKey = await computeReferenceCacheKey(reference);
    const root = await navigator.storage.getDirectory();
    const app = await root.getDirectoryHandle(INDEX_CACHE_LAYOUT.rootName);
    const entries = await app.getDirectoryHandle(INDEX_CACHE_LAYOUT.entriesName);
    const entry = await entries.getDirectoryHandle(cacheKey);
    const files = await entry.getDirectoryHandle(INDEX_CACHE_LAYOUT.filesName);
    const handle = await files.getFileHandle(fileName);
    const access = await handle.createSyncAccessHandle();
    const byte = new Uint8Array(1);
    try {
      if (access.read(byte, { at: 0 }) !== 1) throw new Error(`${fileName} is empty.`);
      byte[0] ^= 0xff;
      if (access.write(byte, { at: 0 }) !== 1) throw new Error(`${fileName} corruption write failed.`);
      access.flush();
    } finally {
      access.close();
    }
    self.postMessage({ type: 'result', result: { cacheKey, fileName, sizePreserved: true } });
  } catch (error) {
    self.postMessage({ type: 'error', name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack || null });
  }
};
