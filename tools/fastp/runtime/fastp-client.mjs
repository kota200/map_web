export class FastpClient {
  constructor() {
    this.worker = null;
    this.rejectActive = null;
  }

  run(config, onEvent = () => {}) {
    if (this.worker) throw new Error('A fastp run is already active.');
    const worker = new Worker(new URL('./fastp-worker.mjs', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise((resolve, reject) => {
      this.rejectActive = reject;
      const finish = () => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        this.rejectActive = null;
      };
      worker.onmessage = (event) => {
        const message = event.data;
        onEvent(message);
        if (message?.type === 'result') {
          finish();
          if (message.result.exitCode === 0) resolve(message.result);
          else {
            const error = new Error(`fastp exited with code ${message.result.exitCode}.`);
            error.result = message.result;
            reject(error);
          }
        } else if (message?.type === 'error') {
          finish();
          reject(new Error(message.message || 'fastp worker failed.'));
        }
      };
      worker.onerror = (event) => {
        finish();
        reject(new Error(event.message || 'fastp worker failed.'));
      };
      worker.postMessage({ type: 'run', config });
    });
  }

  cancel() {
    if (!this.worker) return false;
    const worker = this.worker;
    const reject = this.rejectActive;
    this.worker = null;
    this.rejectActive = null;
    worker.terminate();
    reject?.(new DOMException('fastp stopped by user.', 'AbortError'));
    return true;
  }
}
