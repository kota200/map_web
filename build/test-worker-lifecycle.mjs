import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('js/app.js');
const client = read('js/kallisto-client.js');
const worker = read('js/kallisto-worker.js');
const html = read('index.html');
const patcher = read('build/patch_kallisto_for_wasm.py');
const pairedReader = read('build/wasm_paired_fastq.cpp.inc');
const main = read('vendor/kallisto/src/main.cpp');

assert.match(app, /args\.push\(`\/reads\/R1_/);
assert.match(worker, /data: freshBlobView\(item\.blob\)/);
assert.match(worker, /const readsMountDir = `\/read-mounts\/sample_\$\{sampleIndex \+ 1\}`/);
assert.match(worker, /FS\.mount\(Module\.WORKERFS, \{ blobs \}, readsMountDir\)/);
assert.match(worker, /FS\.symlink\(mountedPath, inputPath\)/);
assert.match(worker, /probeMountedInput\(FS, inputPath\)/);
assert.match(worker, /FS\.unmount\(readsMountDir\)/);
assert.match(patcher, /Could not locate ParseOptionsEM long option table/);
const emParser = main.slice(main.indexOf('void ParseOptionsEM'), main.indexOf('void ParseOptionsTCCQuant'));
assert.match(emParser, /struct option long_options\[\]/);
assert.doesNotMatch(emParser, /static struct option long_options\[\]/);
assert.match(patcher, /wasm_paired_fastq\.cpp\.inc/);
assert.match(patcher, /PTHREAD_POOL_SIZE=9/);
assert.match(pairedReader, /startPairedReaderHelper/);
assert.match(pairedReader, /paired_reader_helper_cv\.wait/);
assert.match(pairedReader, /beginPairedReaderTask\(\[&\]\(\) \{ fill_lane\(1\); \}\)/);
assert.doesNotMatch(pairedReader, /std::thread\s+(mate|reader|r2)/);
assert.match(worker, /paired_parallel_gzip/);
assert.match(worker, /worker_stats/);
assert.match(worker, /prepareTrackedInstantiation/);
assert.match(worker, /wasm_peak_linear_memory_bytes/);
assert.match(worker, /WebAssembly\.Memory grows monotonically/);
assert.match(app, /Wasm linear-memory high water/);
assert.match(app, /indexPerformance/);
assert.match(worker, /metadata\.operation \|\| 'quant'/);

const runtimeVersion = worker.match(/RUNTIME_CACHE_VERSION = '([^']+)'/)?.[1];
assert.ok(runtimeVersion, 'Worker runtime cache version is missing.');
assert.equal((html.match(/app\.js\?v=([^"']+)/) || [])[1], runtimeVersion);
for (const match of client.matchAll(/kallisto-worker\.js\?v=([^'"`]+)/g)) {
  assert.equal(match[1], runtimeVersion);
}
assert.equal([...client.matchAll(/kallisto-worker\.js\?v=/g)].length, 2);

console.log('Worker lifecycle tests passed.');
