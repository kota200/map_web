import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFastp } from '../runtime/fastp-runner.mjs';

const projectRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const inputDir = resolve(projectRoot, 'test-data/fastp/inputs');
const outputDir = resolve(projectRoot, 'test-data/fastp/wasm-v0.23.4');
mkdirSync(outputDir, { recursive: true });

const cases = [
  {
    name: 'se',
    config: {
      mode: 'se',
      inputs: { read1: new Uint8Array(readFileSync(resolve(inputDir, 'se.fastq.gz'))) },
      options: {
        threads: 1,
        lengthRequired: 15,
        compression: 4,
        reportTitle: 'fastp W2 SE fixture',
        adapterSequence: 'AGATCGGAAGAGCACACGTCTGAACTCCAGTCA',
      },
    },
  },
  {
    name: 'pe',
    config: {
      mode: 'pe',
      inputs: {
        read1: new Uint8Array(readFileSync(resolve(inputDir, 'pe.R1.fastq.gz'))),
        read2: new Uint8Array(readFileSync(resolve(inputDir, 'pe.R2.fastq.gz'))),
      },
      options: {
        threads: 1,
        lengthRequired: 15,
        compression: 4,
        reportTitle: 'fastp W2 PE fixture',
        disableAdapterTrimming: true,
      },
    },
  },
];

for (const testCase of cases) {
  const result = await runFastp(testCase.config);
  writeFileSync(resolve(outputDir, `${testCase.name}.stdout.log`), `${result.stdout.join('\n')}${result.stdout.length ? '\n' : ''}`);
  writeFileSync(resolve(outputDir, `${testCase.name}.stderr.log`), `${result.stderr.join('\n')}${result.stderr.length ? '\n' : ''}`);
  writeFileSync(resolve(outputDir, `${testCase.name}.exit-code.txt`), `${result.exitCode}\n`);
  writeFileSync(resolve(outputDir, `${testCase.name}.arguments.json`), `${JSON.stringify(result.args, null, 2)}\n`);
  for (const [name, bytes] of Object.entries(result.outputs)) {
    writeFileSync(resolve(outputDir, name), bytes);
  }
  if (result.exitCode !== 0) throw new Error(`${testCase.name} exited ${result.exitCode}`);
}

const malformed = await runFastp({
  mode: 'se',
  inputs: {
    read1: new Uint8Array(readFileSync(resolve(inputDir, 'malformed.fastq.gz'))),
  },
  options: { threads: 1, disableAdapterTrimming: true },
});
writeFileSync(resolve(outputDir, 'malformed.stderr.log'), `${malformed.stderr.join('\n')}\n`);
writeFileSync(resolve(outputDir, 'malformed.exit-code.txt'), `${malformed.exitCode}\n`);
if (malformed.exitCode === 0) throw new Error('Malformed FASTQ unexpectedly exited 0.');

console.log('fastp-Wasm Node SE/PE and nonzero-exit fixtures completed.');
