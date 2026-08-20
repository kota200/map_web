import createFastpModule from '../dist/fastp.mjs';

const OUTPUT_ROOT = '/output';
const INPUT_ROOT = '/input';

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
    throw new TypeError('fastp mode must be "se" or "pe".');
  }
  if (!config.inputs?.read1) throw new TypeError('read1 input is required.');
  if (config.mode === 'pe' && !config.inputs?.read2) {
    throw new TypeError('read2 input is required for paired-end mode.');
  }
  const threads = config.options?.threads ?? 1;
  if (!Number.isInteger(threads) || threads < 1 || threads > 4) {
    throw new RangeError('fastp threads must be an integer from 1 to 4.');
  }
}

function mountInputs(Module, config) {
  const { FS, WORKERFS } = Module;
  FS.mkdir(INPUT_ROOT);
  const values = [config.inputs.read1];
  if (config.mode === 'pe') values.push(config.inputs.read2);
  const useWorkerFs = values.every(isBlobLike);

  if (useWorkerFs) {
    FS.mount(WORKERFS, { files: values }, INPUT_ROOT);
    return {
      read1: `${INPUT_ROOT}/${config.inputs.read1.name}`,
      read2: config.mode === 'pe' ? `${INPUT_ROOT}/${config.inputs.read2.name}` : null,
      mounted: true,
    };
  }

  const read1 = `${INPUT_ROOT}/read1.fastq${config.inputs.read1Gzip === false ? '' : '.gz'}`;
  FS.writeFile(read1, asBytes(config.inputs.read1, 'read1'));
  let read2 = null;
  if (config.mode === 'pe') {
    read2 = `${INPUT_ROOT}/read2.fastq${config.inputs.read2Gzip === false ? '' : '.gz'}`;
    FS.writeFile(read2, asBytes(config.inputs.read2, 'read2'));
  }
  return { read1, read2, mounted: false };
}

export function buildFastpArguments(config, paths) {
  validateConfig(config);
  const options = config.options ?? {};
  const threads = options.threads ?? 1;
  const lengthRequired = options.lengthRequired ?? 15;
  const compression = options.compression ?? 4;
  if (!Number.isInteger(lengthRequired) || lengthRequired < 1 || lengthRequired > 100000) {
    throw new RangeError('lengthRequired must be an integer from 1 to 100000.');
  }
  if (!Number.isInteger(compression) || compression < 1 || compression > 9) {
    throw new RangeError('compression must be an integer from 1 to 9.');
  }

  const args = [
    '--in1', paths.read1,
    '--out1', paths.cleanedRead1 ?? `${OUTPUT_ROOT}/${config.mode === 'pe' ? 'pe.R1.cleaned.fastq.gz' : 'se.cleaned.fastq.gz'}`,
    '--json', `${OUTPUT_ROOT}/${config.mode}.fastp.json`,
    '--html', `${OUTPUT_ROOT}/${config.mode}.fastp.html`,
    '--report_title', options.reportTitle ?? `fastp W2 ${config.mode.toUpperCase()} fixture`,
    '--thread', String(threads),
    '--dont_eval_duplication',
    '--disable_trim_poly_g',
    '--length_required', String(lengthRequired),
    '--compression', String(compression),
  ];

  if (config.mode === 'pe') {
    args.splice(2, 0, '--in2', paths.read2);
    args.splice(8, 0, '--out2', paths.cleanedRead2 ?? `${OUTPUT_ROOT}/pe.R2.cleaned.fastq.gz`);
  }
  if (options.disableAdapterTrimming) args.push('--disable_adapter_trimming');
  if (options.adapterSequence) args.push('--adapter_sequence', options.adapterSequence);
  return args;
}

function readOutputs(Module, mode, externalNames = new Set()) {
  const names = mode === 'pe'
    ? ['pe.R1.cleaned.fastq.gz', 'pe.R2.cleaned.fastq.gz', 'pe.fastp.json', 'pe.fastp.html']
    : ['se.cleaned.fastq.gz', 'se.fastp.json', 'se.fastp.html'];
  return Object.fromEntries(names
    .filter((name) => !externalNames.has(name))
    .map((name) => [name, Module.FS.readFile(`${OUTPUT_ROOT}/${name}`)]));
}

export async function runFastp(config, hooks = {}) {
  validateConfig(config);
  const stdout = [];
  const stderr = [];
  let onExitCode = null;
  const Module = await createFastpModule({
    noInitialRun: true,
    thisProgram: 'fastp',
    print(line) {
      const text = String(line);
      stdout.push(text);
      hooks.onStdout?.(text);
    },
    printErr(line) {
      const text = String(line);
      stderr.push(text);
      hooks.onStderr?.(text);
    },
    onExit(status) {
      onExitCode = Number(status);
    },
  });

  Module.FS.mkdir(OUTPUT_ROOT);
  const paths = mountInputs(Module, config);
  const cleanedNames = config.mode === 'pe'
    ? ['pe.R1.cleaned.fastq.gz', 'pe.R2.cleaned.fastq.gz']
    : ['se.cleaned.fastq.gz'];
  const outputTargets = [];
  if (typeof hooks.prepareOutput === 'function') {
    for (const [index, name] of cleanedNames.entries()) {
      const defaultPath = `${OUTPUT_ROOT}/${name}`;
      const target = await hooks.prepareOutput(Module, { name, defaultPath });
      if (!target?.path || typeof target.finish !== 'function') {
        throw new TypeError('prepareOutput must return an output path and finish function.');
      }
      outputTargets.push({ name, target });
      if (index === 0) paths.cleanedRead1 = target.path;
      else paths.cleanedRead2 = target.path;
    }
  }
  const args = buildFastpArguments(config, paths);
  hooks.onRunning?.({ args: [...args] });

  let returnedCode;
  try {
    returnedCode = Module.callMain([...args]);
  } catch (error) {
    if (!Number.isInteger(error?.status)) {
      await Promise.all(outputTargets.map(({ target }) => target.finish(false)));
      throw error;
    }
    returnedCode = error.status;
  }
  const exitCode = Number.isInteger(onExitCode)
    ? onExitCode
    : (Number.isInteger(returnedCode) ? returnedCode : 0);
  const outputArtifacts = {};
  for (const { name, target } of outputTargets) {
    outputArtifacts[name] = await target.finish(exitCode === 0);
  }
  const externalNames = new Set(outputTargets.map(({ name }) => name));
  const outputs = exitCode === 0 ? readOutputs(Module, config.mode, externalNames) : {};

  if (typeof process !== 'undefined' && process?.versions?.node) process.exitCode = 0;
  return {
    exitCode,
    args,
    stdout,
    stderr,
    outputs,
    ...(outputTargets.length ? { outputArtifacts } : {}),
  };
}
