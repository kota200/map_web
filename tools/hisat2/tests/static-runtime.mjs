import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const runner = await readFile(resolve(root, 'tools/hisat2/runtime/hisat2-runner.mjs'), 'utf8');
const worker = await readFile(resolve(root, 'tools/hisat2/runtime/hisat2-worker.mjs'), 'utf8');
const client = await readFile(resolve(root, 'tools/hisat2/runtime/hisat2-client.mjs'), 'utf8');
const sourceLock = JSON.parse(await readFile(resolve(root, 'tools/hisat2/source.lock.json'), 'utf8'));
const artifacts = JSON.parse(await readFile(resolve(root, 'tools/hisat2/artifacts.lock.json'), 'utf8'));
const patch = await readFile(resolve(root, 'tools/hisat2/patches/apply-wasm-port.py'), 'utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.match(runner, /createHisat2Module/);
assert.match(runner, /WORKERFS/);
assert.match(runner, /callMain/);
assert.match(worker, /onStdout/);
assert.match(worker, /onStderr/);
assert.match(client, /worker\.terminate\(\)/);
assert.match(client, /AbortError/);
assert.equal(sourceLock.hisat2.commit, '0d244324f98de541bce04d45c75e83bc3522f7f4');
assert.equal(sourceLock.wasmToolchain.emscriptenVersion, '6.0.6');
assert.match(patch, /static_cast<TRefOff>/);
for (const artifact of [artifacts.web.javascript, artifacts.web.wasm]) {
  const bytes = await readFile(resolve(root, artifact.path));
  assert.equal(bytes.byteLength, artifact.bytes, `${artifact.path} byte size`);
  assert.equal(sha256(bytes), artifact.sha256, `${artifact.path} SHA-256`);
}
assert.equal(artifacts.reproducibility.consecutiveBuilds, 2);
assert.equal(artifacts.reproducibility.javascriptShaMatched, true);
assert.equal(artifacts.reproducibility.wasmShaMatched, true);
console.log('HISAT2 provenance, artifact, patch, and runtime static contract passed.');
