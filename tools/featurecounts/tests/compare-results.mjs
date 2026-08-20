import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const nativeRoot = resolve(root, 'test-data/featurecounts/native');
const wasmRoot = resolve(root, 'test-data/featurecounts/wasm');

function countProjection(text) {
  const lines = text.trim().split(/\r?\n/).filter((line) => !line.startsWith('#'));
  const header = lines[0].split('\t');
  header[header.length - 1] = 'sample';
  const records = lines.slice(1).map((line) => {
    const fields = line.split('\t');
    return {
      geneId: fields[0], chr: fields[1], start: fields[2], end: fields[3],
      strand: fields[4], length: Number(fields[5]), count: Number(fields[6]),
    };
  });
  return { header, records };
}

function summaryProjection(text) {
  return Object.fromEntries(text.trim().split(/\r?\n/).slice(1).map((line) => {
    const [status, count] = line.split('\t');
    return [status, Number(count)];
  }));
}

for (const mode of ['se', 'pe']) {
  const nativeCounts = await readFile(resolve(nativeRoot, `${mode}.counts.txt`), 'utf8');
  const wasmCounts = await readFile(resolve(wasmRoot, `${mode}.featureCounts.txt`), 'utf8');
  assert.deepEqual(countProjection(wasmCounts), countProjection(nativeCounts), `${mode} raw counts/Length differ`);
  const nativeSummary = await readFile(resolve(nativeRoot, `${mode}.counts.txt.summary`), 'utf8');
  const wasmSummary = await readFile(resolve(wasmRoot, `${mode}.featureCounts.txt.summary`), 'utf8');
  assert.deepEqual(summaryProjection(wasmSummary), summaryProjection(nativeSummary), `${mode} summary differs`);
}

assert.deepEqual(
  countProjection(await readFile(resolve(wasmRoot, 'gff3.featureCounts.txt'), 'utf8')),
  countProjection(await readFile(resolve(nativeRoot, 'gff3.counts.txt'), 'utf8')),
  'GFF3 raw counts/Length differ',
);
assert.deepEqual(
  summaryProjection(await readFile(resolve(wasmRoot, 'gff3.featureCounts.txt.summary'), 'utf8')),
  summaryProjection(await readFile(resolve(nativeRoot, 'gff3.counts.txt.summary'), 'utf8')),
  'GFF3 summary differs',
);

const se = countProjection(await readFile(resolve(wasmRoot, 'se.featureCounts.txt'), 'utf8'));
const pe = countProjection(await readFile(resolve(wasmRoot, 'pe.featureCounts.txt'), 'utf8'));
assert.deepEqual(se.records, [{ geneId: 'g1', chr: 'chrTiny;chrTiny', start: '1;161', end: '80;240', strand: '+;+', length: 160, count: 2 }]);
assert.deepEqual(pe.records, [{ geneId: 'g1', chr: 'chrTiny;chrTiny', start: '1;161', end: '80;240', strand: '+;+', length: 160, count: 1 }]);
console.log('featureCounts native/Wasm raw count, Length, gene order, and assignment summary match for SE/PE plus GFF3.');
