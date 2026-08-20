export class W3StorageClient {
  constructor() {
    this.worker = new Worker(new URL('./storage-worker.mjs', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.worker.onmessage = (event) => this.#onMessage(event.data);
    this.worker.onerror = (event) => this.#failAll(new Error(event.message || 'W3 storage Worker failed.'));
  }

  #onMessage(message) {
    const pending = this.pending.get(message?.id);
    if (!pending) return;
    if (message.type === 'progress') {
      pending.onProgress?.(message);
      return;
    }
    this.pending.delete(message.id);
    if (message.type === 'result') pending.resolve(message.result);
    else {
      const error = message.name === 'AbortError'
        ? new DOMException(message.message, 'AbortError')
        : new Error(message.message || 'W3 storage operation failed.');
      if (message.name && message.name !== 'AbortError') error.name = message.name;
      pending.reject(error);
    }
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

  async cancel(targetId) {
    return this.request('cancel', { targetId });
  }

  close() {
    this.worker.terminate();
    this.#failAll(new DOMException('Storage Worker terminated.', 'AbortError'));
  }
}
