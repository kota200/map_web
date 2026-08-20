import {
  computeReferenceCacheKey,
  deleteCachedReference,
  downloadReference,
  estimateArbitraryStorage,
  estimateReferenceStorage,
  listCachedReferences,
  recoverIncompleteCaches,
  verifyCachedReference,
} from './index-cache.mjs';

function post(id, type, payload = {}) {
  self.postMessage({ id, type, ...payload });
}

async function dispatch(id, message) {
  switch (message.op) {
    case 'cache-key':
      return { cacheKey: await computeReferenceCacheKey(message.reference) };
    case 'estimate-reference':
      return estimateReferenceStorage(message.reference, Number(message.headroomBytes ?? 64 * 1024 * 1024));
    case 'estimate':
      return estimateArbitraryStorage(Number(message.requiredBytes ?? 0), Number(message.headroomBytes ?? 0));
    case 'download':
      return downloadReference(message.reference, {
        headroomBytes: Number(message.headroomBytes ?? 64 * 1024 * 1024),
        chunkBytes: Number(message.chunkBytes ?? 1024 * 1024),
        testChunkDelayMs: Number(message.testChunkDelayMs ?? 0),
        onProgress: (progress) => post(id, 'progress', progress),
      });
    case 'verify': {
      const cacheKey = await computeReferenceCacheKey(message.reference);
      try {
        return await verifyCachedReference(message.reference, {
          verifyHashes: message.verifyHashes !== false,
          onProgress: (progress) => post(id, 'progress', progress),
        });
      } catch (error) {
        if (message.invalidateOnFailure !== false) error.cleanup = await deleteCachedReference(cacheKey);
        throw error;
      }
    }
    case 'recover': return recoverIncompleteCaches();
    case 'list': return listCachedReferences();
    case 'delete': return deleteCachedReference(message.cacheKey);
    default: throw new Error(`Unknown W4 cache operation: ${message.op}`);
  }
}

self.onmessage = (event) => {
  const message = event.data;
  if (!message?.id) return;
  Promise.resolve(dispatch(message.id, message)).then(
    (result) => post(message.id, 'result', { result }),
    (error) => post(message.id, 'error', {
      name: error?.name || 'Error',
      message: error?.message || String(error),
      stack: error?.stack || null,
      cleanup: error?.cleanup || null,
    }),
  );
};
