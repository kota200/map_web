import { runHisat2 } from '../../hisat2/runtime/hisat2-runner.mjs';
import { getCachedReferenceFiles } from '../../w4-catalog/runtime/index-cache.mjs';
import { createOpfsEmscriptenOutputTarget } from '../../w3-storage/runtime/emscripten-sync-device.mjs';
import { getReadyArtifact } from '../../w3-storage/runtime/opfs-artifact-store.mjs';

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

async function inputFromEntry(entryId, name) {
  const { file } = await getReadyArtifact(entryId);
  return new File([file], name, { type: /\.gz$/i.test(name) ? 'application/gzip' : 'text/plain', lastModified: file.lastModified });
}

function normalizedIndex(reference, files) {
  const extension = reference.index_format;
  const result = {};
  for (let part = 1; part <= 8; part += 1) {
    const artifact = reference.files.find((candidate) => candidate.name.endsWith(`.${part}.${extension}`));
    if (!artifact || !files[artifact.name]) throw new Error(`Hosted cache is missing HISAT2 index part ${part}.${extension}.`);
    const name = `tiny.${part}.${extension}`;
    result[name] = new File([files[artifact.name]], name, { type: 'application/octet-stream', lastModified: files[artifact.name].lastModified });
  }
  return result;
}

self.onmessage = async (event) => {
  const message = event.data;
  if (message?.type !== 'run') return;
  try {
    const cached = await getCachedReferenceFiles(message.reference);
    const inputs = { ...message.config.inputs, index: normalizedIndex(message.reference, cached.files) };
    if (message.readEntries?.read1) inputs.read1 = await inputFromEntry(message.readEntries.read1, 'read1.fastq');
    if (message.config.mode === 'pe' && message.readEntries?.read2) inputs.read2 = await inputFromEntry(message.readEntries.read2, 'read2.fastq');
    const result = await runHisat2({ ...message.config, inputs }, {
      onRunning(details) { post('running', details); },
      onStdout(line) { post('stdout', { line }); },
      onStderr(line) { post('stderr', { line }); },
      prepareOutput(Module, { defaultPath, name }) {
        return createOpfsEmscriptenOutputTarget(Module, {
          path: defaultPath,
          entryId: message.samEntryId,
          kind: 'hisat2-sam',
          metadata: { tool: 'hisat2', outputName: name, referenceId: message.reference.id },
        });
      },
    });
    post('result', { result });
  } catch (error) {
    post('error', { name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack || null });
  }
};
