import fs from 'node:fs';
import assert from 'node:assert/strict';
import { OPFS_ARTIFACT_CONSTANTS } from '../runtime/opfs-artifact-store.mjs';
import { installSyncWritableDevice } from '../runtime/emscripten-sync-device.mjs';

assert.equal(OPFS_ARTIFACT_CONSTANTS.schemaVersion, 1);
assert.equal(OPFS_ARTIFACT_CONSTANTS.rootName, 'kallisto-web-w3');

const devices = new Map();
const nodes = new Map();
const FS = {
  ErrnoError: class ErrnoError extends Error {},
  makedev(major, minor) { return (major << 8) | minor; },
  getDevice(device) { return devices.get(device); },
  registerDevice(device, ops) { devices.set(device, { stream_ops: ops }); },
  mkdev(path, mode, device) { nodes.set(path, { mode, device }); },
};
const writes = [];
const writer = {
  accessHandle: {},
  write(bytes, position) {
    writes.push({ bytes: new Uint8Array(bytes), position });
    return bytes.byteLength;
  },
  flushCalls: 0,
  flush() { this.flushCalls += 1; },
  size() { return writes.reduce((size, write) => Math.max(size, write.position + write.bytes.length), 0); },
};
const stats = installSyncWritableDevice({ FS }, '/output/test.sam', writer);
const node = nodes.get('/output/test.sam');
assert(node, 'Emscripten device node was not created.');
const operations = devices.get(node.device).stream_ops;
const stream = { position: 0 };
operations.open(stream);
assert.equal(stream.seekable, true);
assert.equal(operations.write(stream, new Int8Array([65, 66, 67]), 0, 3, 0), 3);
assert.equal(operations.llseek({ position: 3 }, 0, 2), 3);
operations.close(stream);
assert.deepEqual([...writes[0].bytes], [65, 66, 67]);
assert.equal(stats.maxWriteChunkBytes, 3);
assert.equal(stats.seekCalls, 1);
assert.equal(writer.flushCalls, 1);

const requiredMarkers = new Map([
  ['runtime/storage-worker.mjs', ['write-synthetic', 'fetch-to-artifact', 'recoverIncompleteEntries', 'persistWriteMaxBytes']],
  ['runtime/storage-client.mjs', ['Worker', 'AbortError']],
  ['runtime/fastp-opfs-worker.mjs', ['createOpfsEmscriptenOutputTarget', 'fastp-cleaned-fastq']],
  ['runtime/hisat2-opfs-worker.mjs', ['getReadyArtifact', 'hisat2-sam']],
  ['runtime/featurecounts-opfs-worker.mjs', ['getReadyArtifact', 'runFeatureCounts']],
  ['tests/browser-gate.mjs', ['LARGE_BYTES', 'location.reload()', 'fullSizeMainThreadCopies', 'insufficientStorageRejected']],
]);
for (const [relativePath, markers] of requiredMarkers) {
  const source = fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
  for (const marker of markers) assert(source.includes(marker), `${relativePath} is missing ${marker}`);
}

console.log('W3 storage device and static architecture contract passed.');
