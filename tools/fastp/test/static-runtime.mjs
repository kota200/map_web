import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const project = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, project));
const text = (path) => read(path).toString('utf8');
const json = (path) => JSON.parse(text(path));
const sha256 = (path) => createHash('sha256').update(read(path)).digest('hex');

const source = json('tools/fastp/source.lock.json');
const artifacts = json('tools/fastp/artifacts.lock.json');
assert.equal(source.fastp.version, '0.23.4');
assert.equal(source.fastp.commit, '1ffcaed6892832c09c4b4094c201cd4eff8fa622');
assert.equal(source.wasmToolchain.emscriptenVersion, '6.0.6');
assert.equal(source.wasmToolchain.zlib.version, '1.3.2');
assert.equal(sha256('tools/fastp/dist/fastp.mjs'), artifacts.web.javascript.sha256);
assert.equal(sha256('tools/fastp/dist/fastp.wasm'), artifacts.web.wasm.sha256);

const build = text('tools/fastp/build-wasm.sh');
assert.match(build, /EXPECTED_EMSCRIPTEN="6\.0\.6"/);
assert.match(build, /-ffile-prefix-map=/);
assert.match(build, /-sPTHREAD_POOL_SIZE=8/);
assert.match(build, /-lworkerfs\.js/);

const patcher = text('tools/fastp/patches/apply-wasm-port.py');
assert.match(patcher, /expected one match/);
assert.match(patcher, /gzread/);
assert.match(patcher, /gzwrite/);

const runner = text('tools/fastp/runtime/fastp-runner.mjs');
assert.match(runner, /FS\.mount\(WORKERFS/);
assert.match(runner, /onStdout/);
assert.match(runner, /onStderr/);
assert.match(runner, /exitCode/);
assert.doesNotMatch(runner, /\.arguments\s*=|rawCommand|shell/i);

const client = text('tools/fastp/runtime/fastp-client.mjs');
assert.match(client, /worker\.terminate\(\)/);
assert.match(client, /AbortError/);

const index = text('index.html');
assert.doesNotMatch(index, /fastp-worker\.mjs|fastp-runner\.mjs/);
assert.match(text('docs/KNOWN_LIMITATIONS.md'), /current Kallisto behavior remains equivalent to fastp OFF/);

for (const path of [
  'test-data/fastp/inputs/se.fastq.gz',
  'test-data/fastp/inputs/pe.R1.fastq.gz',
  'test-data/fastp/inputs/pe.R2.fastq.gz',
  'test-data/fastp/native-v0.23.4/se.cleaned.fastq.gz',
  'test-data/fastp/wasm-v0.23.4/se.cleaned.fastq.gz',
]) assert.ok(existsSync(new URL(path, project)), `Missing ${path}`);

console.log('fastp W2 provenance, artifact, runtime, and fastp-OFF static checks passed.');
