export class KallistoRunner {
  constructor() {
    this.worker = null;
    this.rejectCurrent = null;
  }

  async checkRuntime() {
    const moduleUrl = new URL('../kallisto/kallisto.js', import.meta.url);
    const wasmUrl = new URL('../kallisto/kallisto.wasm', import.meta.url);
    try {
      const [jsResponse, wasmResponse] = await Promise.all([
        fetch(moduleUrl, { method: 'HEAD', cache: 'no-store' }),
        fetch(wasmUrl, { cache: 'no-store' }),
      ]);
      if (!jsResponse.ok || !wasmResponse.ok) {
        return {
          ready: false,
          moduleStatus: jsResponse.status,
          wasmStatus: wasmResponse.status,
        };
      }

      // Validate/compile the actual module up front. This gives a clear
      // diagnostic on browsers that do not support native WebAssembly Memory64.
      const bytes = await wasmResponse.arrayBuffer();
      await WebAssembly.compile(bytes);
      return { ready: true, moduleStatus: jsResponse.status, wasmStatus: wasmResponse.status };
    } catch (error) {
      return { ready: false, error: String(error) };
    }
  }

  run(payload, onEvent = () => {}) {
    if (this.worker) {
      return Promise.reject(new Error('A kallisto command is already running.'));
    }

    const worker = new Worker(new URL('./kallisto-worker.js?v=20260821-w6-cross-browser', import.meta.url));
    this.worker = worker;

    return new Promise((resolve, reject) => {
      this.rejectCurrent = reject;

      const cleanup = () => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        this.rejectCurrent = null;
      };

      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === 'stdout' || message.type === 'stderr' || message.type === 'status') {
          onEvent(message);
          return;
        }
        if (message.type === 'result') {
          cleanup();
          resolve(message.result);
          return;
        }
        if (message.type === 'error') {
          cleanup();
          reject(new Error(message.message || 'kallisto WebAssembly failed.'));
        }
      };

      worker.onerror = (event) => {
        cleanup();
        reject(new Error(`${event.message || 'kallisto worker failed.'}${event.filename ? ` (${event.filename}:${event.lineno || '?'})` : ''}`));
      };

      worker.postMessage({ type: 'run', payload });
    });
  }

  runBatch(payload, onEvent = () => {}) {
    if (this.worker) {
      return Promise.reject(new Error('A kallisto command is already running.'));
    }

    const worker = new Worker(new URL('./kallisto-worker.js?v=20260821-w6-cross-browser', import.meta.url));
    this.worker = worker;

    return new Promise((resolve, reject) => {
      this.rejectCurrent = reject;
      const cleanup = () => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        this.rejectCurrent = null;
      };
      const forward = (message) => {
        try {
          onEvent(message);
          return true;
        } catch (error) {
          cleanup();
          reject(error);
          return false;
        }
      };

      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === 'stdout' || message.type === 'stderr' ||
            message.type === 'status' || message.type === 'sample-result') {
          forward(message);
          return;
        }
        if (message.type === 'batch-result') {
          cleanup();
          resolve(message.result);
          return;
        }
        if (message.type === 'error') {
          cleanup();
          reject(new Error(message.message || 'kallisto WebAssembly batch failed.'));
        }
      };

      worker.onerror = (event) => {
        cleanup();
        reject(new Error(`${event.message || 'kallisto worker failed.'}${event.filename ? ` (${event.filename}:${event.lineno || '?'})` : ''}`));
      };

      worker.postMessage({ type: 'run-batch', payload });
    });
  }

  cancel() {
    if (!this.worker) return false;
    const worker = this.worker;
    this.worker = null;
    worker.terminate();
    if (this.rejectCurrent) {
      this.rejectCurrent(new Error('Analysis stopped by user.'));
      this.rejectCurrent = null;
    }
    return true;
  }
}
