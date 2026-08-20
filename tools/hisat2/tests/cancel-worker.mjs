import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';

const root = resolve(import.meta.dirname, '../../..');
const indexRoot = resolve(root, 'test-data/hisat2/native/index');
const index = Object.fromEntries(await Promise.all(
  Array.from({ length: 8 }, async (_, part) => {
    const name = `tiny.${part + 1}.ht2`;
    return [name, new Uint8Array(await readFile(resolve(indexRoot, name)))];
  }),
));
const record = '@cancel-read\n' + 'AACCCATCATATTGTGCCGGGCTTATCAGTAGTGTCCGAA\n+\n' + 'I'.repeat(40) + '\n';
const read1 = new TextEncoder().encode(record.repeat(50000));
const worker = new Worker(new URL('../runtime/hisat2-worker.mjs', import.meta.url), { type: 'module' });
const events = [];
worker.on('message', (message) => events.push(message.type));
worker.postMessage({ type: 'run', config: { mode: 'se', inputs: { index, read1 }, options: { threads: 1 } } });

while (!events.includes('running')) {
  await Promise.race([
    once(worker, 'message'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('HISAT2 worker did not reach running state.')), 30000)),
  ]);
}
const terminatedCode = await worker.terminate();
assert.notEqual(terminatedCode, 0);
assert.ok(events.includes('started'));
assert.ok(events.includes('running'));
console.log('HISAT2 Worker termination cancellation passed.');
