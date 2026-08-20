import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const projectRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const nativeDir = resolve(projectRoot, 'test-data/fastp/native-v0.23.4');
const wasmDir = resolve(projectRoot, 'test-data/fastp/wasm-v0.23.4');

const json = (dir, name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
const text = (dir, name) => readFileSync(resolve(dir, name), 'utf8');
const cleaned = (dir, name) => gunzipSync(readFileSync(resolve(dir, name))).toString('utf8');

function metricProjection(report) {
  const summaryKeys = [
    'total_reads', 'total_bases', 'q20_bases', 'q30_bases', 'q20_rate', 'q30_rate',
    'read1_mean_length', 'read2_mean_length', 'gc_content',
  ];
  const pick = (source, keys) => Object.fromEntries(keys.map((key) => [key, source?.[key] ?? null]));
  return {
    fastp_version: report.fastp_version,
    before_filtering: pick(report.summary.before_filtering, summaryKeys),
    after_filtering: pick(report.summary.after_filtering, summaryKeys),
    filtering_result: report.filtering_result,
    adapter_cutting: report.adapter_cutting ?? null,
    insert_size: report.insert_size ?? null,
  };
}

for (const mode of ['se', 'pe']) {
  assert.equal(text(nativeDir, `${mode}.exit-code.txt`).trim(), '0');
  assert.equal(text(wasmDir, `${mode}.exit-code.txt`).trim(), '0');
  assert.deepEqual(
    metricProjection(json(wasmDir, `${mode}.fastp.json`)),
    metricProjection(json(nativeDir, `${mode}.fastp.json`)),
    `${mode} major QC metrics differ`,
  );
  assert.match(text(wasmDir, `${mode}.stderr.log`), /fastp v0\.23\.4/);
  assert.match(text(wasmDir, `${mode}.fastp.html`), new RegExp(`fastp W2 ${mode.toUpperCase()} fixture`));
}

for (const name of ['se.cleaned.fastq.gz', 'pe.R1.cleaned.fastq.gz', 'pe.R2.cleaned.fastq.gz']) {
  assert.equal(cleaned(wasmDir, name), cleaned(nativeDir, name), `${name} decompressed records differ`);
}

const malformedCode = Number(text(wasmDir, 'malformed.exit-code.txt').trim());
assert.ok(malformedCode !== 0, 'malformed FASTQ must propagate a nonzero exit code');
assert.match(text(wasmDir, 'malformed.stderr.log'), /sequence and quality have different length/);

console.log('fastp native/Wasm semantic comparison passed for SE, PE, QC metrics, and nonzero exit.');
