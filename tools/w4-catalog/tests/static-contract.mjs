import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateIndexCatalog } from '../../../js/index-catalog.mjs';
import { computeReferenceCacheKey } from '../runtime/index-cache.mjs';
import { IncrementalSha256 } from '../runtime/sha256-incremental.mjs';

const repositoryRoot = new URL('../../../', import.meta.url);
const configUrl = new URL('config/index-catalog.json', repositoryRoot);
const config = JSON.parse(fs.readFileSync(configUrl, 'utf8'));
assert.equal(config.schema_version, 1);
assert.equal(config.environment, 'local-test');
assert.equal(config.production_configured, false);
assert.ok(!/^https?:\/\/[^/]*example\./i.test(config.catalog_url), 'A placeholder production URL must not be configured.');

const catalogUrl = new URL(config.catalog_url, configUrl);
const rawCatalog = JSON.parse(fs.readFileSync(catalogUrl, 'utf8'));
const catalog = validateIndexCatalog(rawCatalog, { baseUrl: catalogUrl });
assert.equal(catalog.references.length, 1);
const reference = catalog.references[0];
assert.equal(reference.id, 'synthetic-chrtiny-hisat2-2.2.3-v1');
assert.equal(reference.hisat2_version, '2.2.3');
assert.deepEqual(reference.build_arguments, ['--ss', 'splice-sites.txt', '--exon', 'exons.txt', 'genome.fa', 'tiny']);
assert.equal(reference.files.length, 8);
assert.equal(reference.annotation.format, 'GTF');
assert.deepEqual(reference.annotation.contigs, ['chrTiny']);
assert.deepEqual(reference.contigs, [{ name: 'chrTiny', length: 240 }]);

let totalBytes = 0;
for (const artifact of [...reference.files, reference.annotation]) {
  const bytes = fs.readFileSync(fileURLToPath(artifact.url));
  assert.equal(bytes.byteLength, artifact.size, `${artifact.name}: size mismatch`);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), artifact.sha256, `${artifact.name}: SHA-256 mismatch`);
  totalBytes += bytes.byteLength;
}
assert.equal(totalBytes, 4203807);
assert.equal(reference.total_size, totalBytes);

for (const length of [0, 1, 55, 56, 63, 64, 65, 4097, 1024 * 1024 + 17]) {
  const bytes = Buffer.alloc(length);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 131 + 29) & 0xff;
  const expected = crypto.createHash('sha256').update(bytes).digest('hex');
  for (const chunkBytes of [1, 7, 64, 1009, 65536]) {
    const hasher = new IncrementalSha256();
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) hasher.update(bytes.subarray(offset, offset + chunkBytes));
    assert.equal(hasher.digestHex(), expected, `incremental SHA-256 failed for ${length}/${chunkBytes}`);
  }
}

const cacheKey = await computeReferenceCacheKey(reference);
assert.match(cacheKey, new RegExp(`^${reference.id}-[a-f0-9]{64}$`));
assert.equal(await computeReferenceCacheKey(reference), cacheKey);
const checksumChanged = structuredClone(reference);
checksumChanged.files[7].sha256 = `${checksumChanged.files[7].sha256.slice(0, -1)}0`;
if (checksumChanged.files[7].sha256 === reference.files[7].sha256) checksumChanged.files[7].sha256 = `${checksumChanged.files[7].sha256.slice(0, -1)}1`;
assert.notEqual(await computeReferenceCacheKey(checksumChanged), cacheKey, 'Cache key must include every index checksum.');
const versionChanged = structuredClone(reference);
versionChanged.hisat2_version = '2.2.4';
assert.notEqual(await computeReferenceCacheKey(versionChanged), cacheKey, 'Cache key must include the exact HISAT2 version.');

const missingPart = structuredClone(rawCatalog);
missingPart.references[0].files.pop();
assert.throws(() => validateIndexCatalog(missingPart, { baseUrl: catalogUrl }), /exactly eight/);
const incompatible = structuredClone(rawCatalog);
incompatible.references[0].annotation.contigs = ['chrMissing'];
assert.throws(() => validateIndexCatalog(incompatible, { baseUrl: catalogUrl }), /absent/);

const schema = JSON.parse(fs.readFileSync(new URL('contracts/index-catalog.schema.json', repositoryRoot), 'utf8'));
assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
assert.equal(schema.$defs.annotation.additionalProperties, false);
assert.ok(schema.$defs.reference.required.includes('build_arguments'));
assert.ok(schema.$defs.reference.required.includes('source_urls'));
assert.ok(schema.$defs.reference.required.includes('licenses'));

const cacheRuntime = fs.readFileSync(new URL('tools/w4-catalog/runtime/index-cache.mjs', repositoryRoot), 'utf8');
assert.match(cacheRuntime, /ready\.json/);
assert.match(cacheRuntime, /partial\.json/);
assert.match(cacheRuntime, /SHA-256 mismatch/);
assert.match(cacheRuntime, /Insufficient storage/);
assert.match(cacheRuntime, /createSyncAccessHandle/);
assert.match(cacheRuntime, /validateCachedAnnotationContigs/);

console.log(`W4 catalog contract passed: 9 artifacts, ${totalBytes} bytes, cache ${cacheKey}.`);
