import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runFeatureCounts } from '../runtime/featurecounts-runner.mjs';

const root = resolve(import.meta.dirname, '../../..');
const wasmRoot = resolve(root, 'test-data/featurecounts/wasm');
await mkdir(wasmRoot, { recursive: true });
const annotation = new Uint8Array(await readFile(resolve(root, 'test-data/hisat2/inputs/annotation.gtf')));

for (const mode of ['se', 'pe']) {
  const result = await runFeatureCounts({
    mode,
    inputs: {
      annotation,
      sam: new Uint8Array(await readFile(resolve(root, `test-data/hisat2/native/${mode}.sam`))),
    },
    options: { threads: 1, strandedness: 0, featureType: 'exon', attribute: 'gene_id' },
  });
  if (result.exitCode !== 0) {
    throw new Error(`${mode} exited ${result.exitCode}:\n${result.stderr.join('\n')}`);
  }
  await writeFile(resolve(wasmRoot, `${mode}.featureCounts.txt`), result.outputs['featureCounts.txt']);
  await writeFile(resolve(wasmRoot, `${mode}.featureCounts.txt.summary`), result.outputs['featureCounts.txt.summary']);
  await writeFile(resolve(wasmRoot, `${mode}.stderr.txt`), `${result.stderr.join('\n')}\n`);
  await writeFile(resolve(wasmRoot, `${mode}.exit-code.txt`), `${result.exitCode}\n`);
  console.log(`${mode.toUpperCase()} exit=0 outputs captured.`);
}

const gff3Result = await runFeatureCounts({
  mode: 'se',
  inputs: {
    annotation: new Uint8Array(await readFile(resolve(root, 'test-data/featurecounts/inputs/annotation.gff3'))),
    sam: new Uint8Array(await readFile(resolve(root, 'test-data/hisat2/native/se.sam'))),
  },
  options: { threads: 1, strandedness: 0, featureType: 'exon', attribute: 'gene_id' },
});
if (gff3Result.exitCode !== 0) throw new Error(`GFF3 exited ${gff3Result.exitCode}`);
await writeFile(resolve(wasmRoot, 'gff3.featureCounts.txt'), gff3Result.outputs['featureCounts.txt']);
await writeFile(resolve(wasmRoot, 'gff3.featureCounts.txt.summary'), gff3Result.outputs['featureCounts.txt.summary']);
console.log('GFF3 exit=0 outputs captured.');
