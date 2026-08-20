import { runFeatureCounts } from '../../featurecounts/runtime/featurecounts-runner.mjs';
import { getReadyArtifact } from './opfs-artifact-store.mjs';

self.onmessage = async (event) => {
  const message = event.data;
  if (message?.type !== 'run') return;
  try {
    const { file: samFile } = await getReadyArtifact(message.samEntryId);
    const sam = new File([samFile], message.config.mode === 'pe' ? 'pe.sam' : 'se.sam', {
      type: 'text/plain',
      lastModified: samFile.lastModified,
    });
    const config = {
      ...message.config,
      inputs: { ...message.config.inputs, sam },
    };
    const result = await runFeatureCounts(config, {
      onRunning(details) { self.postMessage({ type: 'running', ...details }); },
      onStdout(line) { self.postMessage({ type: 'stdout', line }); },
      onStderr(line) { self.postMessage({ type: 'stderr', line }); },
    });
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack || null });
  }
};
