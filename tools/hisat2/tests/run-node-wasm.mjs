import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runHisat2 } from '../runtime/hisat2-runner.mjs';

const root = resolve(import.meta.dirname, '../../..');
const inputRoot = resolve(root, 'test-data/hisat2/inputs');
const nativeRoot = resolve(root, 'test-data/hisat2/native');
const wasmRoot = resolve(root, 'test-data/hisat2/wasm');

const index = Object.fromEntries(await Promise.all(
  Array.from({ length: 8 }, async (_, part) => {
    const name = `tiny.${part + 1}.ht2`;
    return [name, new Uint8Array(await readFile(resolve(nativeRoot, 'index', name)))];
  }),
));

await mkdir(wasmRoot, { recursive: true });
for (const mode of ['se', 'pe']) {
  const config = {
    mode,
    inputs: {
      index,
      read1: new Uint8Array(await readFile(resolve(inputRoot, mode === 'se' ? 'se.fastq' : 'pe_R1.fastq'))),
      ...(mode === 'pe' ? {
        read2: new Uint8Array(await readFile(resolve(inputRoot, 'pe_R2.fastq'))),
      } : {}),
    },
    options: { threads: 1 },
  };
  const result = await runHisat2(config);
  if (result.exitCode !== 0) {
    throw new Error(`${mode} exited ${result.exitCode}:\n${result.stderr.join('\n')}`);
  }
  await writeFile(resolve(wasmRoot, `${mode}.sam`), result.outputs[`${mode}.sam`]);
  await writeFile(resolve(wasmRoot, `${mode}.stderr.txt`), `${result.stderr.join('\n')}\n`);
  console.log(`${mode.toUpperCase()} exit=0 ${result.stderr.at(-1)}`);
}
