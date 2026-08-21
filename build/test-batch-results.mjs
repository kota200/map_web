import assert from 'node:assert/strict';
import { MatrixBuilder } from '../js/batch-results.mjs';

function buffer(text) {
  return new TextEncoder().encode(text).buffer;
}

const header = 'target_id\tlength\teff_length\test_counts\ttpm\n';
const first = `${header}geneA\t100\t80\t120.3\t15.23\ngeneB\t90\t70\t0\t0\n`;
const second = `${header}geneA\t100\t80\t98.2\t13.91\ngeneB\t90\t70\t4.2\t0.43\n`;

const builder = new MatrixBuilder();
builder.addSample('sample1', buffer(first));
builder.addSample('sample2', buffer(second));
const matrices = builder.toMatrices();
assert.equal(matrices.counts, 'target_id\tsample1\tsample2\ngeneA\t120.3\t98.2\ngeneB\t0\t4.2\n');
assert.equal(matrices.tpm, 'target_id\tsample1\tsample2\ngeneA\t15.23\t13.91\ngeneB\t0\t0.43\n');
builder.release();

const reordered = new MatrixBuilder();
reordered.addSample('sample1', buffer(first));
assert.throws(
  () => reordered.addSample('sample2', buffer(`${header}geneB\t90\t70\t4.2\t0.43\ngeneA\t100\t80\t98.2\t13.91\n`)),
  /target order differs/
);

const missing = new MatrixBuilder();
missing.addSample('sample1', buffer(first));
assert.throws(
  () => missing.addSample('sample2', buffer(`${header}geneA\t100\t80\t98.2\t13.91\n`)),
  /target count differs/
);

console.log('Batch matrix tests passed.');
