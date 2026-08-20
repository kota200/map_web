import { runFeatureCounts } from './featurecounts-runner.mjs';

async function createHost() {
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    return {
      onMessage(handler) { self.onmessage = (event) => handler(event.data); },
      post(message) { self.postMessage(message); },
    };
  }
  const { parentPort } = await import('node:worker_threads');
  if (!parentPort) throw new Error('featureCounts worker requires a Worker host.');
  return {
    onMessage(handler) { parentPort.on('message', handler); },
    post(message) { parentPort.postMessage(message); },
  };
}

const host = await createHost();
let active = false;
host.onMessage(async (message) => {
  if (message?.type !== 'run') return;
  if (active) {
    host.post({ type: 'error', message: 'A featureCounts run is already active.', exitCode: null });
    return;
  }
  active = true;
  host.post({ type: 'started' });
  try {
    const result = await runFeatureCounts(message.config, {
      onStdout(line) { host.post({ type: 'stdout', line }); },
      onStderr(line) { host.post({ type: 'stderr', line }); },
      onRunning(details) { host.post({ type: 'running', ...details }); },
    });
    host.post({ type: 'result', result });
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
