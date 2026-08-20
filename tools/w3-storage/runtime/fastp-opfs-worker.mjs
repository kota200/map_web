import { runFastp } from '../../fastp/runtime/fastp-runner.mjs';
import { createOpfsEmscriptenOutputTarget } from './emscripten-sync-device.mjs';

self.onmessage = async (event) => {
  const message = event.data;
  if (message?.type !== 'run') return;
  try {
    const result = await runFastp(message.config, {
      onRunning(details) { self.postMessage({ type: 'running', ...details }); },
      onStdout(line) { self.postMessage({ type: 'stdout', line }); },
      onStderr(line) { self.postMessage({ type: 'stderr', line }); },
      async prepareOutput(Module, { name, defaultPath }) {
        const entryId = message.outputEntries?.[name];
        if (!entryId) throw new Error(`Missing OPFS entry for ${name}.`);
        return createOpfsEmscriptenOutputTarget(Module, {
          path: defaultPath,
          entryId,
          kind: 'fastp-cleaned-fastq',
          metadata: { tool: 'fastp', outputName: name },
        });
      },
    });
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack || null });
  }
};
