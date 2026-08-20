import { runHisat2 } from '../../hisat2/runtime/hisat2-runner.mjs';
import { createOpfsEmscriptenOutputTarget } from './emscripten-sync-device.mjs';
import { getReadyArtifact } from './opfs-artifact-store.mjs';

const INDEX_PARTS = Array.from({ length: 8 }, (_, index) => `tiny.${index + 1}.ht2`);

async function namedFile(entryId, name) {
  const { file } = await getReadyArtifact(entryId);
  return new File([file], name, { type: file.type, lastModified: file.lastModified });
}

self.onmessage = async (event) => {
  const message = event.data;
  if (message?.type !== 'run') return;
  try {
    const index = Object.fromEntries(await Promise.all(INDEX_PARTS.map(async (name) => {
      const entryId = message.indexEntries?.[name];
      if (!entryId) throw new Error(`Missing OPFS index descriptor for ${name}.`);
      return [name, await namedFile(entryId, name)];
    })));
    const config = {
      ...message.config,
      inputs: { ...message.config.inputs, index },
    };
    const result = await runHisat2(config, {
      onRunning(details) { self.postMessage({ type: 'running', ...details }); },
      onStdout(line) { self.postMessage({ type: 'stdout', line }); },
      onStderr(line) { self.postMessage({ type: 'stderr', line }); },
      prepareOutput(Module, { defaultPath, name }) {
        return createOpfsEmscriptenOutputTarget(Module, {
          path: defaultPath,
          entryId: message.samEntryId,
          kind: 'hisat2-sam',
          metadata: { tool: 'hisat2', outputName: name },
        });
      },
    });
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack || null });
  }
};
