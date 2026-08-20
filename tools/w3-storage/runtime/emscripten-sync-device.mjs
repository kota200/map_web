import { finishArtifactWriter, openArtifactWriter } from './opfs-artifact-store.mjs';

let nextMinor = 1;

function allocateDevice(FS) {
  while (nextMinor < 255) {
    const device = FS.makedev(240, nextMinor++);
    if (!FS.getDevice(device)) return device;
  }
  throw new Error('No Emscripten device number is available for OPFS output.');
}

export function installSyncWritableDevice(Module, path, writer) {
  const FS = Module?.FS;
  if (!FS?.registerDevice || !FS?.mkdev) throw new Error('The Emscripten FS device API is unavailable.');
  if (!writer?.accessHandle) throw new TypeError('An open OPFS writer is required.');
  const device = allocateDevice(FS);
  const stats = {
    path,
    writeCalls: 0,
    bytesWritten: 0,
    maxWriteChunkBytes: 0,
    seekCalls: 0,
    openCalls: 0,
    closeCalls: 0,
  };
  FS.registerDevice(device, {
    open(stream) {
      stream.seekable = true;
      stats.openCalls += 1;
    },
    close() {
      writer.flush();
      stats.closeCalls += 1;
    },
    write(stream, buffer, offset, length, position) {
      const view = buffer.subarray(offset, offset + length);
      const written = writer.write(view, position);
      stats.writeCalls += 1;
      stats.bytesWritten = Math.max(stats.bytesWritten, position + written);
      stats.maxWriteChunkBytes = Math.max(stats.maxWriteChunkBytes, written);
      return written;
    },
    llseek(stream, offset, whence) {
      let position;
      if (whence === 0) position = offset;
      else if (whence === 1) position = stream.position + offset;
      else if (whence === 2) position = writer.size() + offset;
      else throw new FS.ErrnoError(28);
      if (!Number.isSafeInteger(position) || position < 0) throw new FS.ErrnoError(28);
      stats.seekCalls += 1;
      return position;
    },
  });
  FS.mkdev(path, 0o666, device);
  return stats;
}

export async function createOpfsEmscriptenOutputTarget(Module, {
  path,
  entryId,
  kind,
  expectedBytes = null,
  metadata = {},
}) {
  const writer = await openArtifactWriter(entryId, { kind, expectedBytes });
  const deviceStats = installSyncWritableDevice(Module, path, writer);
  let finished = false;
  return {
    path,
    async finish(success) {
      if (finished) throw new Error(`OPFS output target ${entryId} was finalized twice.`);
      finished = true;
      return finishArtifactWriter(writer, {
        ready: success,
        metadata: { deviceStats, ...metadata },
      });
    },
  };
}
