import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runFeatureCounts } from '../runtime/featurecounts-runner.mjs';

const root = resolve(import.meta.dirname, '../../..');
const result = await runFeatureCounts({
  mode: 'se',
  inputs: {
    sam: new Uint8Array(await readFile(resolve(root, 'test-data/hisat2/native/se.sam'))),
    annotation: new TextEncoder().encode('not\ta\tvalid\tannotation\n'),
  },
  options: { threads: 1 },
});
assert.notEqual(result.exitCode, 0);
assert.ok(result.stderr.length > 0);
assert.deepEqual(result.outputs, {});
console.log(`featureCounts malformed annotation propagated exit ${result.exitCode}.`);
