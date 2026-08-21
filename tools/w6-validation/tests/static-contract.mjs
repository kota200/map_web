import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { assertHisat2WebResources, estimateHisat2WebResources, WEB_RESOURCE_LIMITS } from '../runtime/resource-policy.mjs';

const appRoot = new URL('../../../', import.meta.url);
const workspaceRoot = new URL('../../../../', import.meta.url);
const lock = JSON.parse(fs.readFileSync(new URL('tools/w6-validation/example-data.lock.json', appRoot), 'utf8'));
const requireRepresentativeFiles = process.env.W6_REQUIRE_REPRESENTATIVE_FILES !== '0';

assert.equal(lock.schema_version, 1);
assert.equal(lock.files.length, 5);
let availableRepresentativeFiles = 0;
for (const record of lock.files) {
  const path = new URL(record.relative_path_from_workspace.replaceAll('\\', '/'), workspaceRoot);
  if (!fs.existsSync(path)) {
    assert.equal(
      requireRepresentativeFiles,
      false,
      `${record.name} is unavailable. Set W6_REQUIRE_REPRESENTATIVE_FILES=0 only for synthetic CI.`,
    );
    continue;
  }
  availableRepresentativeFiles += 1;
  const stat = fs.statSync(path);
  assert.equal(stat.size, record.size_bytes, `${record.name} size differs from W6 lock.`);
  if (process.env.W6_VERIFY_LARGE_HASHES === '1') {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(path)) hash.update(chunk);
    assert.equal(hash.digest('hex'), record.sha256, `${record.name} SHA-256 differs from W6 lock.`);
  }
}
if (requireRepresentativeFiles) assert.equal(availableRepresentativeFiles, lock.files.length);

const byRole = new Map(lock.files.map((record) => [record.role, record]));
const read1 = byRole.get('paired-read-1');
const read2 = byRole.get('paired-read-2');
const genome = byRole.get('genome-fasta-gzip');
const annotation = byRole.get('annotation-gff3-gzip');
assert(read1 && read2, 'W6 lock must retain both representative FASTQ mates.');
assert(genome && annotation, 'W6 lock must retain the matching genome FASTA and GFF3.');

const tiny = estimateHisat2WebResources({
  referenceBytes: 4_203_807,
  samples: [{ read1: [{ name: 'tiny.fq.gz', size: 1024 }] }],
  availableBytes: 10 * 1024 * 1024 * 1024,
});
assert.equal(tiny.supported, true);
assert.equal(tiny.recommendDesktop, false);

const representative = estimateHisat2WebResources({
  referenceBytes: 4_203_807,
  samples: [{
    read1: [{ name: read1.name, size: read1.size_bytes }],
    read2: [{ name: read2.name, size: read2.size_bytes }],
  }],
  runFastp: true,
  availableBytes: 100 * 1024 * 1024 * 1024,
});
assert.equal(representative.recommendDesktop, true);
assert(representative.temporaryBytes > 20 * 1024 * 1024 * 1024);
assert(representative.warnings.some((warning) => /verified desktop workflow/.test(warning)));

assert.throws(() => assertHisat2WebResources({
  referenceBytes: WEB_RESOURCE_LIMITS.conservativeIndexPayloadBytes,
  samples: [],
  availableBytes: 10 * 1024 * 1024 * 1024,
}), (error) => error.name === 'WebResourceLimitError' && /validated Web reference envelope/.test(error.message));

assert.throws(() => assertHisat2WebResources({
  referenceBytes: 4_203_807,
  samples: [{ read1: [{ name: 'reads.fq.gz', size: 1024 * 1024 }] }],
  availableBytes: 1024,
}), (error) => error.name === 'QuotaPreflightError' && /storage/.test(error.message));

const html = fs.readFileSync(new URL('index.html', appRoot), 'utf8');
const app = fs.readFileSync(new URL('js/app.js', appRoot), 'utf8');
const preprocessor = fs.readFileSync(new URL('tools/w6-validation/runtime/kallisto-fastp.mjs', appRoot), 'utf8');
assert.match(html, /Run fastp preprocessing/);
assert.match(html, /id="runKallistoFastp" type="checkbox"/);
assert.doesNotMatch(html, /id="runKallistoFastp"[^>]+checked/);
assert.match(app, /KallistoFastpPreprocessor/);
assert.match(app, /fastp OFF — established Kallisto input path/);
assert.match(preprocessor, /fastp-opfs-worker\.mjs/);
assert.match(preprocessor, /retainedEntries/);
assert.match(preprocessor, /AbortError/);

const representativeMode = availableRepresentativeFiles === lock.files.length
  ? 'representative files verified'
  : `synthetic CI; ${lock.files.length - availableRepresentativeFiles} representative files intentionally unavailable`;
console.log(`W6 static contract passed (${representativeMode}; ${lock.files.reduce((sum, file) => sum + file.size_bytes, 0)} locked bytes).`);
