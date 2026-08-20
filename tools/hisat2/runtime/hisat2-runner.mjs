import createHisat2Module from '../dist/hisat2.mjs';

const INPUT_ROOT = '/input';
const OUTPUT_ROOT = '/output';
const INDEX_PARTS = Array.from({ length: 8 }, (_, index) => `tiny.${index + 1}.ht2`);

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
    throw new TypeError('HISAT2 mode must be "se" or "pe".');
  }
  if (!config.inputs?.read1) throw new TypeError('read1 input is required.');
  if (config.mode === 'pe' && !config.inputs?.read2) {
    throw new TypeError('read2 input is required for paired-end mode.');
  }
  for (const name of INDEX_PARTS) {
    if (!config.inputs?.index?.[name]) throw new TypeError(`Missing HISAT2 index part: ${name}`);
  }
  const threads = config.options?.threads ?? 1;
  if (!Number.isInteger(threads) || threads < 1 || threads > 4) {
    throw new RangeError('HISAT2 threads must be an integer from 1 to 4.');
  }
}

function writeOrMountInputs(Module, config) {
  const indexValues = INDEX_PARTS.map((name) => config.inputs.index[name]);
  const values = [...indexValues, config.inputs.read1];
  if (config.mode === 'pe') values.push(config.inputs.read2);
  const read1Name = /\.gz$/i.test(config.inputs.read1?.name || '') ? 'read1.fastq.gz' : 'read1.fastq';
  const read2Name = /\.gz$/i.test(config.inputs.read2?.name || '') ? 'read2.fastq.gz' : 'read2.fastq';

  if (values.every(isBlobLike)) {
    const files = values.map((value, index) => {
      const name = index < 8
        ? INDEX_PARTS[index]
        : (index === 8 ? read1Name : read2Name);
      if (typeof File !== 'undefined' && value instanceof File && value.name === name) return value;
      return new File([value], name);
    });
    Module.FS.mount(Module.WORKERFS, { files }, INPUT_ROOT);
    return {
      read1: `${INPUT_ROOT}/${files[8].name}`,
      read2: config.mode === 'pe' ? `${INPUT_ROOT}/${files[9].name}` : null,
    };
  }

  for (const name of INDEX_PARTS) {
    Module.FS.writeFile(`${INPUT_ROOT}/${name}`, asBytes(config.inputs.index[name], name));
  }
  Module.FS.writeFile(`${INPUT_ROOT}/${read1Name}`, asBytes(config.inputs.read1, 'read1'));
  if (config.mode === 'pe') {
    Module.FS.writeFile(`${INPUT_ROOT}/${read2Name}`, asBytes(config.inputs.read2, 'read2'));
  }
  return {
    read1: `${INPUT_ROOT}/${read1Name}`,
    read2: config.mode === 'pe' ? `${INPUT_ROOT}/${read2Name}` : null,
  };
}

export function buildHisat2Arguments(config, paths) {
  validateConfig(config);
  const outputName = config.mode === 'pe' ? 'pe.sam' : 'se.sam';
  const args = [
    '--wrapper', 'basic-0',
    '-x', `${INPUT_ROOT}/tiny`,
    '-p', String(config.options?.threads ?? 1),
  ];
  if (config.mode === 'pe') args.push('-1', paths.read1, '-2', paths.read2);
  else args.push('-U', paths.read1);
  args.push('-S', paths.output ?? `${OUTPUT_ROOT}/${outputName}`);
  return args;
}

export async function runHisat2(config, hooks = {}) {
  validateConfig(config);
  const stdout = [];
  const stderr = [];
  let onExitCode = null;
  const Module = await createHisat2Module({
    noInitialRun: true,
    thisProgram: 'hisat2-align-s',
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
  const outputName = config.mode === 'pe' ? 'pe.sam' : 'se.sam';
  const defaultOutputPath = `${OUTPUT_ROOT}/${outputName}`;
  let outputTarget = null;
  if (typeof hooks.prepareOutput === 'function') {
    outputTarget = await hooks.prepareOutput(Module, { name: outputName, defaultPath: defaultOutputPath });
    if (!outputTarget?.path || typeof outputTarget.finish !== 'function') {
      throw new TypeError('prepareOutput must return an output path and finish function.');
    }
    paths.output = outputTarget.path;
  }
  const args = buildHisat2Arguments(config, paths);
  hooks.onRunning?.({ args: [...args] });

  let returnedCode;
  try {
    returnedCode = Module.callMain([...args]);
  } catch (error) {
    if (!Number.isInteger(error?.status)) {
      if (outputTarget) {
        await outputTarget.finish(false);
      }
      throw error;
    }
    returnedCode = error.status;
  }
  const exitCode = Number.isInteger(onExitCode)
    ? onExitCode
    : (Number.isInteger(returnedCode) ? returnedCode : 0);
  const outputArtifact = outputTarget
    ? await outputTarget.finish(exitCode === 0)
    : null;
  const outputs = exitCode === 0 && !outputTarget
    ? { [outputName]: Module.FS.readFile(`${OUTPUT_ROOT}/${outputName}`, { encoding: 'utf8' }) }
    : {};
  if (typeof process !== 'undefined' && process?.versions?.node) process.exitCode = 0;
  return { exitCode, args, stdout, stderr, outputs, ...(outputArtifact ? { outputArtifact } : {}) };
}
