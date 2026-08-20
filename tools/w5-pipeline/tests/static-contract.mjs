import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildMatrices, calculateTpm, countsTsv, countsWithTpmTsv, parseAssignmentSummary, parseFeatureCounts } from '../runtime/results.mjs';
import { combineFastqFiles, preflightSamples, safeSampleId } from '../runtime/preflight.mjs';

const root = new URL('../../../', import.meta.url);
const seNative = fs.readFileSync(new URL('test-data/featurecounts/native/se.counts.txt', root), 'utf8');
const peNative = fs.readFileSync(new URL('test-data/featurecounts/native/pe.counts.txt', root), 'utf8');
const seSummary = fs.readFileSync(new URL('test-data/featurecounts/native/se.counts.txt.summary', root), 'utf8');
const seRows = parseFeatureCounts(seNative);
const peRows = parseFeatureCounts(peNative);
assert.deepEqual(seRows, [{ geneId: 'g1', length: 160, count: 2 }]);
assert.deepEqual(peRows, [{ geneId: 'g1', length: 160, count: 1 }]);
assert.equal(parseAssignmentSummary(seSummary).Assigned, 2);
assert.deepEqual(calculateTpm(seRows).rows, [{ geneId: 'g1', length: 160, count: 2, tpm: 1_000_000 }]);
assert.deepEqual(calculateTpm(peRows).rows, [{ geneId: 'g1', length: 160, count: 1, tpm: 1_000_000 }]);
assert.equal(countsTsv(seRows), 'Geneid\tLength\tCount\ng1\t160\t2\n');
assert.equal(countsWithTpmTsv(calculateTpm(seRows).rows), 'Geneid\tLength\tCount\tTPM\ng1\t160\t2\t1000000\n');
const zero = calculateTpm([{ geneId: 'zero', length: 100, count: 0 }]);
assert.equal(zero.rows[0].tpm, 0);
assert.match(zero.warnings[0], /set to 0/);
assert.throws(() => calculateTpm([{ geneId: 'bad', length: 0, count: 1 }]), /Length must be positive/);
assert.throws(() => parseFeatureCounts(seNative.replace('\t160\t2', '\t0\t2')), /Length must be a positive/);

const matrices = buildMatrices([
  { name: 'α sample', tpmRows: calculateTpm(seRows).rows },
  { name: 'paired', tpmRows: calculateTpm(peRows).rows },
]);
assert.equal(matrices.counts, 'Geneid\tLength\tα sample\tpaired\ng1\t160\t2\t1\n');
assert.equal(matrices.tpm, 'Geneid\tLength\tα sample\tpaired\ng1\t160\t1000000\t1000000\n');
assert.throws(() => buildMatrices([
  { name: 'a', tpmRows: calculateTpm(seRows).rows },
  { name: 'b', tpmRows: [{ geneId: 'other', length: 160, count: 1, tpm: 1_000_000 }] },
]), /Geneid\/Length\/order differs/);

const seFastq = '@read1\nACGT\n+\nIIII\n@read2\nTGCA\n+\nIIII\n';
const r1Fastq = '@pair1/1\nACGT\n+\nIIII\n';
const r2Fastq = '@pair1/2\nTGCA\n+\nIIII\n';
const unicodeFile = new File([seFastq], '測定 01.fastq', { type: 'text/plain' });
const normalized = await preflightSamples([{ name: '患者 α / sample', mode: 'se', read1: [unicodeFile] }]);
assert.equal(normalized[0].name, '患者 α / sample');
assert.match(normalized[0].sampleId, /^sample-01-/);
assert.equal(safeSampleId('患者', 0), 'sample-01-unicode');
assert.equal(safeSampleId('../CON<>:"/\\|?*', 0), 'sample-01-CON');
assert.equal(combineFastqFiles([unicodeFile], 'safe').name, 'safe.fastq');
await preflightSamples([{ name: 'paired', mode: 'pe', read1: [new File([r1Fastq], 'R1.fq')], read2: [new File([r2Fastq], 'R2.fq')] }]);
await assert.rejects(preflightSamples([{ name: 'lane mismatch', mode: 'pe', read1: [new File([r1Fastq], 'R1a.fq'), new File([r1Fastq], 'R1b.fq')], read2: [new File([r2Fastq], 'R2.fq')] }]), /file counts must match/);
await assert.rejects(preflightSamples([{ name: 'bad pair', mode: 'pe', read1: [new File([r1Fastq], 'R1.fq')], read2: [new File([r2Fastq.replace('pair1', 'pair2')], 'R2.fq')] }]), /do not pair/);
await assert.rejects(preflightSamples([{ name: 'dup', mode: 'se', read1: [unicodeFile] }, { name: 'dup', mode: 'se', read1: [unicodeFile] }]), /Duplicate sample name/);
await assert.rejects(preflightSamples([{ name: 'empty', mode: 'se', read1: [new File([], 'empty.fastq')] }]), /empty/);
await assert.rejects(preflightSamples([{ name: 'extension', mode: 'se', read1: [new File([seFastq], 'reads.txt')] }]), /must end in/);

const runnerSource = fs.readFileSync(new URL('tools/w5-pipeline/runtime/browser-runner.mjs', root), 'utf8');
const hisatSource = fs.readFileSync(new URL('tools/w5-pipeline/runtime/hisat2-catalog-worker.mjs', root), 'utf8');
const featureSource = fs.readFileSync(new URL('tools/w5-pipeline/runtime/featurecounts-catalog-worker.mjs', root), 'utf8');
assert.match(runnerSource, /runFastp: options\.runFastp === true/);
assert.match(runnerSource, /counting_unit: sample\.mode === 'pe' \? 'fragments' : 'reads'/);
assert.match(runnerSource, /temporary SAM removed/);
assert.match(runnerSource, /counts_matrix\.tsv/);
assert.match(runnerSource, /batch_manifest\.json/);
assert.match(hisatSource, /getCachedReferenceFiles/);
assert.match(hisatSource, /createOpfsEmscriptenOutputTarget/);
assert.match(featureSource, /ContigMismatchError/);
assert.match(featureSource, /ZeroAssignedError/);
assert.match(fs.readFileSync(new URL('tools/hisat2/runtime/hisat2-runner.mjs', root), 'utf8'), /read1\.fastq\.gz/);

console.log('W5 preflight, native-count parsing, TPM, matrix, and file-backed pipeline contracts passed.');
