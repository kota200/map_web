import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';

const root = resolve(import.meta.dirname, '../../..');
const annotation = new Uint8Array(await readFile(resolve(root, 'test-data/hisat2/inputs/annotation.gtf')));
const header = '@HD\tVN:1.0\tSO:unsorted\n@SQ\tSN:chrTiny\tLN:240\n';
const alignment = 'cancel\t0\tchrTiny\t11\t60\t40M\t*\t0\t0\tAACCCATCATATTGTGCCGGGCTTATCAGTAGTGTCCGAA\tIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII\n';
const sam = new TextEncoder().encode(header + alignment.repeat(250000));
const worker = new Worker(new URL('../runtime/featurecounts-worker.mjs', import.meta.url), { type: 'module' });
const events = [];
worker.on('message', (message) => events.push(message.type));
worker.postMessage({ type: 'run', config: { mode: 'se', inputs: { annotation, sam }, options: { threads: 1 } } });
while (!events.includes('running')) {
  await Promise.race([
    once(worker, 'message'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('featureCounts worker did not reach running state.')), 30000)),
  ]);
}
const terminatedCode = await worker.terminate();
assert.notEqual(terminatedCode, 0);
assert.ok(events.includes('started'));
assert.ok(events.includes('running'));
console.log('featureCounts Worker termination cancellation passed.');
