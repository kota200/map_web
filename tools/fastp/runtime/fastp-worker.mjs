import { runFastp } from './fastp-runner.mjs';

async function createHost() {
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    return {
      onMessage(handler) { self.onmessage = (event) => handler(event.data); },
      post(message, transfer = []) { self.postMessage(message, transfer); },
    };
  }
  const { parentPort } = await import('node:worker_threads');
  if (!parentPort) throw new Error('fastp worker requires a Worker host.');
  return {
    onMessage(handler) { parentPort.on('message', handler); },
    post(message, transfer = []) { parentPort.postMessage(message, transfer); },
  };
}

const host = await createHost();
let active = false;

host.onMessage(async (message) => {
  if (message?.type !== 'run') return;
  if (active) {
    host.post({ type: 'error', message: 'A fastp run is already active.', exitCode: null });
    return;
  }
  active = true;
  host.post({ type: 'started' });
  try {
    const result = await runFastp(message.config, {
      onStdout(line) { host.post({ type: 'stdout', line }); },
      onStderr(line) { host.post({ type: 'stderr', line }); },
      onRunning(details) { host.post({ type: 'running', ...details }); },
    });
    const transfer = Object.values(result.outputs).map((bytes) => bytes.buffer);
    host.post({ type: 'result', result }, transfer);
  } catch (error) {
    host.post({
      type: 'error',
      message: error?.message || String(error),
      stack: error?.stack || null,
      exitCode: Number.isInteger(error?.status) ? error.status : null,
    });
  } finally {
    active = false;
  }
});
