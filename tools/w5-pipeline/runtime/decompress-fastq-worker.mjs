import { finishArtifactWriter, getReadyArtifact, openArtifactWriter } from '../../w3-storage/runtime/opfs-artifact-store.mjs';

self.onmessage = async (event) => {
  const message = event.data;
  if (message?.type !== 'run') return;
  let writer = null;
  try {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot stream-decompress gzip FASTQ.');
    const source = message.sourceEntryId ? (await getReadyArtifact(message.sourceEntryId)).file : message.file;
    if (!(source instanceof Blob)) throw new TypeError('gzip FASTQ source is missing.');
    writer = await openArtifactWriter(message.targetEntryId, { kind: 'w5-decompressed-fastq' });
    const reader = source.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    let position = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const written = writer.write(value, position);
      if (written !== value.byteLength) throw new Error('Partial OPFS write while decompressing FASTQ.');
      position += written;
      self.postMessage({ type: 'progress', completedBytes: position });
    }
    const state = await finishArtifactWriter(writer, { ready: true, metadata: { sourceEncoding: 'gzip', outputEncoding: 'identity' } });
    writer = null;
    self.postMessage({ type: 'result', result: { state } });
  } catch (error) {
    if (writer) await finishArtifactWriter(writer, { ready: false }).catch(() => {});
    self.postMessage({ type: 'error', name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack || null });
  }
};
