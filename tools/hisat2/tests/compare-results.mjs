import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const nativeRoot = resolve(root, 'test-data/hisat2/native');
const wasmRoot = resolve(root, 'test-data/hisat2/wasm');

function semanticSam(text) {
  return text.trim().split(/\r?\n/).filter((line) => !line.startsWith('@PG'));
}

for (const mode of ['se', 'pe']) {
  const nativeSam = semanticSam(await readFile(resolve(nativeRoot, `${mode}.sam`), 'utf8'));
  const wasmSam = semanticSam(await readFile(resolve(wasmRoot, `${mode}.sam`), 'utf8'));
  assert.deepEqual(wasmSam, nativeSam, `${mode} SAM records differ`);
  assert.match(await readFile(resolve(wasmRoot, `${mode}.stderr.txt`), 'utf8'), /100\.00% overall alignment rate/);
}

const se = await readFile(resolve(wasmRoot, 'se.sam'), 'utf8');
const pe = await readFile(resolve(wasmRoot, 'pe.sam'), 'utf8');
assert.match(se, /se_exonic\t0\tchrTiny\t11\t60\t40M\t/);
assert.match(se, /se_spliced\t0\tchrTiny\t61\t60\t20M80N20M\t/);
assert.match(pe, /pe_pair\t99\tchrTiny\t21\t60\t40M\t=\t181\t120\t/);
assert.match(pe, /pe_pair\t147\tchrTiny\t181\t60\t40M\t=\t21\t-120\t/);
console.log('HISAT2 native/Wasm semantic comparison passed for SE, PE, splice CIGAR, flags, and TLEN.');
