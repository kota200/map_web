import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';

const record = '@cancel-read\n' + 'ACGT'.repeat(25) + '\n+\n' + 'I'.repeat(100) + '\n';
const input = new TextEncoder().encode(record.repeat(250000));
const worker = new Worker(new URL('../runtime/fastp-worker.mjs', import.meta.url), { type: 'module' });
const events = [];
worker.on('message', (message) => events.push(message.type));
worker.postMessage({
  type: 'run',
  config: {
    mode: 'se',
    inputs: { read1: input, read1Gzip: false },
    options: { threads: 1, disableAdapterTrimming: true },
  },
}, [input.buffer]);

while (!events.includes('running')) {
  await Promise.race([
    once(worker, 'message'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('fastp worker did not reach running state.')), 30000)),
  ]);
}
const terminatedCode = await worker.terminate();
assert.notEqual(terminatedCode, 0);
assert.ok(events.includes('started'));
assert.ok(events.includes('running'));
console.log('fastp Worker termination cancellation passed.');
