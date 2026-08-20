export class W4IndexCacheClient {
  constructor() {
    this.worker = new Worker(new URL('./cache-worker.mjs', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.worker.onmessage = (event) => this.#onMessage(event.data);
    this.worker.onerror = (event) => this.#failAll(new Error(event.message || 'W4 index cache Worker failed.'));
  }

  #onMessage(message) {
    const pending = this.pending.get(message?.id);
    if (!pending) return;
    if (message.type === 'progress') {
      pending.onProgress?.(message);
      return;
    }
    this.pending.delete(message.id);
    if (message.type === 'result') {
      pending.resolve(message.result);
      return;
    }
    const error = message.name === 'AbortError'
      ? new DOMException(message.message || 'Index cache operation aborted.', 'AbortError')
      : new Error(message.message || 'W4 index cache operation failed.');
    if (message.name && message.name !== 'AbortError') error.name = message.name;
    if (message.stack) error.workerStack = message.stack;
    if (message.cleanup) error.cleanup = message.cleanup;
    pending.reject(error);
  }

  #failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  request(op, payload = {}, onProgress = null) {
    const id = crypto.randomUUID();
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ id, op, ...payload });
    });
    promise.requestId = id;
    return promise;
  }

  close() {
    this.worker.terminate();
    this.#failAll(new DOMException('Index cache Worker terminated.', 'AbortError'));
  }
}
