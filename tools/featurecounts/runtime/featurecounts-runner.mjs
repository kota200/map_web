import createFeatureCountsModule from '../dist/featureCounts.mjs';

const INPUT_ROOT = '/input';
const OUTPUT_ROOT = '/output';

function isBlobLike(value) {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function asBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`${label} must be a File, Blob, Uint8Array, or ArrayBuffer.`);
}

function validateConfig(config) {
  if (!config || (config.mode !== 'se' && config.mode !== 'pe')) {
    throw new TypeError('featureCounts mode must be "se" or "pe".');
  }
  if (!config.inputs?.sam) throw new TypeError('SAM input is required.');
  if (!config.inputs?.annotation) throw new TypeError('Annotation input is required.');
  const threads = config.options?.threads ?? 1;
  if (!Number.isInteger(threads) || threads < 1 || threads > 4) {
    throw new RangeError('featureCounts threads must be an integer from 1 to 4.');
  }
  const strandedness = config.options?.strandedness ?? 0;
  if (![0, 1, 2].includes(strandedness)) {
    throw new RangeError('featureCounts strandedness must be 0, 1, or 2.');
  }
}

function writeOrMountInputs(Module, config) {
  const values = [config.inputs.sam, config.inputs.annotation];
  if (values.every(isBlobLike)) {
    const sam = config.inputs.sam instanceof File
      ? config.inputs.sam
      : new File([config.inputs.sam], 'input.sam');
    const annotation = config.inputs.annotation instanceof File
      ? config.inputs.annotation
      : new File([config.inputs.annotation], 'annotation.gtf');
    Module.FS.mount(Module.WORKERFS, { files: [sam, annotation] }, INPUT_ROOT);
    return { sam: `${INPUT_ROOT}/${sam.name}`, annotation: `${INPUT_ROOT}/${annotation.name}` };
  }
  Module.FS.writeFile(`${INPUT_ROOT}/input.sam`, asBytes(config.inputs.sam, 'sam'));
  Module.FS.writeFile(`${INPUT_ROOT}/annotation.gtf`, asBytes(config.inputs.annotation, 'annotation'));
  return { sam: `${INPUT_ROOT}/input.sam`, annotation: `${INPUT_ROOT}/annotation.gtf` };
}

export function buildFeatureCountsArguments(config, paths) {
  validateConfig(config);
  const options = config.options ?? {};
  const args = [
    '-T', String(options.threads ?? 1),
    '-s', String(options.strandedness ?? 0),
    '-t', options.featureType ?? 'exon',
    '-g', options.attribute ?? 'gene_id',
  ];
  if (config.mode === 'pe') args.push('-p', '--countReadPairs');
  args.push('-a', paths.annotation, '-o', `${OUTPUT_ROOT}/featureCounts.txt`, paths.sam);
  return args;
}

export async function runFeatureCounts(config, hooks = {}) {
  validateConfig(config);
  const stdout = [];
  const stderr = [];
  let onExitCode = null;
  const Module = await createFeatureCountsModule({
    noInitialRun: true,
    thisProgram: 'featureCounts',
    print(line) {
      const value = String(line);
      stdout.push(value);
      hooks.onStdout?.(value);
    },
    printErr(line) {
      const value = String(line);
      stderr.push(value);
      hooks.onStderr?.(value);
    },
    onExit(status) {
      onExitCode = Number(status);
    },
  });
  Module.FS.mkdir(INPUT_ROOT);
  Module.FS.mkdir(OUTPUT_ROOT);
  const paths = writeOrMountInputs(Module, config);
  const args = buildFeatureCountsArguments(config, paths);
  hooks.onRunning?.({ args: [...args] });

  let returnedCode;
  try {
    returnedCode = Module.callMain([...args]);
  } catch (error) {
    if (!Number.isInteger(error?.status)) throw error;
    returnedCode = error.status;
  }
  const exitCode = Number.isInteger(onExitCode)
    ? onExitCode
    : (Number.isInteger(returnedCode) ? returnedCode : 0);
  const outputs = exitCode === 0 ? {
    'featureCounts.txt': Module.FS.readFile(`${OUTPUT_ROOT}/featureCounts.txt`, { encoding: 'utf8' }),
    'featureCounts.txt.summary': Module.FS.readFile(`${OUTPUT_ROOT}/featureCounts.txt.summary`, { encoding: 'utf8' }),
  } : {};
  if (typeof process !== 'undefined' && process?.versions?.node) process.exitCode = 0;
  return { exitCode, args, stdout, stderr, outputs };
}
