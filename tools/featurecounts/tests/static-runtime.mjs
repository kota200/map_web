import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const runner = await readFile(resolve(root, 'tools/featurecounts/runtime/featurecounts-runner.mjs'), 'utf8');
const worker = await readFile(resolve(root, 'tools/featurecounts/runtime/featurecounts-worker.mjs'), 'utf8');
const client = await readFile(resolve(root, 'tools/featurecounts/runtime/featurecounts-client.mjs'), 'utf8');
const sourceLock = JSON.parse(await readFile(resolve(root, 'tools/featurecounts/source.lock.json'), 'utf8'));
const artifacts = JSON.parse(await readFile(resolve(root, 'tools/featurecounts/artifacts.lock.json'), 'utf8'));
const patch = await readFile(resolve(root, 'tools/featurecounts/patches/apply-wasm-port.py'), 'utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.match(runner, /createFeatureCountsModule/);
assert.match(runner, /--countReadPairs/);
assert.match(runner, /WORKERFS/);
assert.match(worker, /onStdout/);
assert.match(worker, /onStderr/);
assert.match(client, /worker\.terminate\(\)/);
assert.match(client, /AbortError/);
assert.equal(sourceLock.subread.version, '2.1.1');
assert.equal(sourceLock.subread.sourceArchiveSha256, '6392d7c66831cdd767e58251892a79a51b6fab8ed0ba9671ad5e85ff1ab01eaa');
assert.equal(sourceLock.wasmToolchain.emscriptenVersion, '6.0.6');
assert.match(patch, /__EMSCRIPTEN__/);
for (const artifact of [artifacts.web.javascript, artifacts.web.wasm]) {
  const bytes = await readFile(resolve(root, artifact.path));
  assert.equal(bytes.byteLength, artifact.bytes, `${artifact.path} byte size`);
  assert.equal(sha256(bytes), artifact.sha256, `${artifact.path} SHA-256`);
}
assert.equal(artifacts.reproducibility.consecutiveBuilds, 2);
assert.equal(artifacts.reproducibility.javascriptShaMatched, true);
assert.equal(artifacts.reproducibility.wasmShaMatched, true);
console.log('featureCounts provenance, artifact, patch, and runtime static contract passed.');
