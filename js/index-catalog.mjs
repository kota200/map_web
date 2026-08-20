const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string.`);
  return value;
}

function requireAllowedKeys(value, allowed, label) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length) throw new TypeError(`${label} contains unsupported fields: ${unknown.join(', ')}.`);
}

function validateArtifact(artifact, label, baseUrl, extraFields = []) {
  requireObject(artifact, label);
  requireAllowedKeys(artifact, ['name', 'url', 'size', 'sha256', ...extraFields], label);
  if (!SAFE_NAME_PATTERN.test(requireString(artifact.name, `${label}.name`))) throw new TypeError(`${label}.name is unsafe.`);
  requireString(artifact.url, `${label}.url`);
  if (!Number.isSafeInteger(artifact.size) || artifact.size < 1) throw new RangeError(`${label}.size must be positive.`);
  if (!SHA256_PATTERN.test(artifact.sha256)) throw new TypeError(`${label}.sha256 must be lowercase SHA-256.`);
  return { ...artifact, url: new URL(artifact.url, baseUrl).href };
}

export function validateIndexReference(reference, {
  baseUrl = globalThis.location?.href ?? 'file:///',
  allowComputedTotal = false,
} = {}) {
  requireObject(reference, 'reference');
  requireAllowedKeys(reference, [
    'id', 'display_name', 'organism', 'assembly', 'hisat2_version', 'index_format',
    'build_arguments', 'files', 'annotation', 'contigs', 'source_urls', 'licenses',
    'created_at', 'test_only', ...(allowComputedTotal ? ['total_size'] : []),
  ], 'reference');
  if (!SAFE_ID_PATTERN.test(requireString(reference.id, 'reference.id'))) throw new TypeError('reference.id is invalid.');
  for (const key of ['display_name', 'organism', 'assembly', 'hisat2_version', 'index_format', 'created_at']) {
    requireString(reference[key], `reference.${key}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(reference.hisat2_version)) throw new TypeError('reference.hisat2_version must be an exact semantic version.');
  if (!['ht2', 'ht2l'].includes(reference.index_format)) throw new TypeError('reference.index_format must be ht2 or ht2l.');
  if (!Array.isArray(reference.build_arguments) || reference.build_arguments.length === 0 || reference.build_arguments.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new TypeError('reference.build_arguments must be a non-empty string array.');
  }
  if (!Array.isArray(reference.files) || reference.files.length !== 8) throw new TypeError('reference.files must contain exactly eight index components.');
  const files = reference.files.map((artifact, index) => validateArtifact(artifact, `reference.files[${index}]`, baseUrl));
  const names = new Set(files.map((artifact) => artifact.name));
  if (names.size !== files.length) throw new TypeError('reference.files contains duplicate names.');
  const extension = reference.index_format === 'ht2' ? 'ht2' : 'ht2l';
  let indexBasename = null;
  for (let part = 1; part <= 8; part += 1) {
    const matches = [...names].filter((name) => name.endsWith(`.${part}.${extension}`));
    if (matches.length !== 1) {
      throw new TypeError(`reference.files is missing index part ${part}.${extension}.`);
    }
    const basename = matches[0].slice(0, -`.${part}.${extension}`.length);
    if (!basename || (indexBasename != null && basename !== indexBasename)) throw new TypeError('reference.files must share one index basename.');
    indexBasename = basename;
  }
  const annotation = validateArtifact(reference.annotation, 'reference.annotation', baseUrl, [
    'format', 'version', 'default_feature_type', 'default_grouping_attribute', 'contigs',
  ]);
  if (names.has(annotation.name)) throw new TypeError('reference.annotation.name collides with an index component.');
  for (const key of ['format', 'version', 'default_feature_type', 'default_grouping_attribute']) {
    requireString(reference.annotation[key], `reference.annotation.${key}`);
  }
  if (!['GTF', 'GFF3'].includes(reference.annotation.format)) throw new TypeError('annotation.format must be GTF or GFF3.');
  if (!Array.isArray(reference.annotation.contigs) || reference.annotation.contigs.length === 0) {
    throw new TypeError('annotation.contigs must be a non-empty array.');
  }
  if (new Set(reference.annotation.contigs).size !== reference.annotation.contigs.length) throw new TypeError('annotation.contigs must be unique.');
  const contigs = reference.contigs;
  if (!Array.isArray(contigs) || contigs.length === 0) throw new TypeError('reference.contigs must be non-empty.');
  const referenceContigs = new Set();
  for (const [index, contig] of contigs.entries()) {
    requireObject(contig, `reference.contigs[${index}]`);
    requireAllowedKeys(contig, ['name', 'length'], `reference.contigs[${index}]`);
    referenceContigs.add(requireString(contig.name, `reference.contigs[${index}].name`));
    if (!Number.isSafeInteger(contig.length) || contig.length < 1) throw new RangeError(`reference.contigs[${index}].length is invalid.`);
  }
  if (referenceContigs.size !== contigs.length) throw new TypeError('reference.contigs must have unique names.');
  for (const contig of reference.annotation.contigs) {
    if (!referenceContigs.has(requireString(contig, 'annotation contig'))) {
      throw new Error(`Annotation contig ${contig} is absent from the index reference contigs.`);
    }
  }
  if (!Array.isArray(reference.source_urls) || reference.source_urls.length === 0) throw new TypeError('reference.source_urls must be non-empty.');
  if (!Array.isArray(reference.licenses) || reference.licenses.length === 0) throw new TypeError('reference.licenses must be non-empty.');
  if (!Number.isFinite(Date.parse(reference.created_at))) throw new TypeError('reference.created_at must be an ISO date-time.');
  if ('test_only' in reference && typeof reference.test_only !== 'boolean') throw new TypeError('reference.test_only must be boolean.');
  const totalSize = files.reduce((sum, artifact) => sum + artifact.size, annotation.size);
  if (allowComputedTotal && reference.total_size !== totalSize) throw new Error('reference.total_size differs from artifact sizes.');
  return {
    ...reference,
    files,
    annotation: { ...reference.annotation, ...annotation, contigs: [...reference.annotation.contigs] },
    contigs: reference.contigs.map((contig) => ({ ...contig })),
    source_urls: reference.source_urls.map((url) => new URL(requireString(url, 'source URL'), baseUrl).href),
    licenses: reference.licenses.map((license) => requireString(license, 'license')),
    total_size: totalSize,
  };
}

export function validateIndexCatalog(catalog, { baseUrl = globalThis.location?.href ?? 'file:///' } = {}) {
  requireObject(catalog, 'catalog');
  requireAllowedKeys(catalog, ['schema_version', 'references'], 'catalog');
  if (catalog.schema_version !== 1) throw new TypeError('catalog.schema_version must be 1.');
  if (!Array.isArray(catalog.references) || catalog.references.length === 0) throw new TypeError('catalog.references must be non-empty.');
  const references = catalog.references.map((reference) => validateIndexReference(reference, { baseUrl }));
  const ids = new Set(references.map((reference) => reference.id));
  if (ids.size !== references.length) throw new TypeError('catalog reference IDs must be unique.');
  return { schema_version: 1, references };
}

export async function loadConfiguredCatalog(configUrl = new URL('../config/index-catalog.json', import.meta.url)) {
  const configResponse = await fetch(configUrl, { cache: 'no-store' });
  if (!configResponse.ok) throw new Error(`Catalog configuration HTTP ${configResponse.status}.`);
  const config = await configResponse.json();
  requireObject(config, 'catalog configuration');
  requireAllowedKeys(config, ['schema_version', 'environment', 'production_configured', 'catalog_url'], 'catalog configuration');
  if (config.schema_version !== 1) throw new TypeError('Catalog configuration schema_version must be 1.');
  if (!['local-test', 'production'].includes(config.environment)) throw new TypeError('Catalog environment is invalid.');
  if (typeof config.production_configured !== 'boolean') throw new TypeError('production_configured must be boolean.');
  const catalogUrl = new URL(requireString(config.catalog_url, 'catalog_url'), configUrl);
  if (config.environment === 'production' && (!config.production_configured || catalogUrl.protocol !== 'https:')) {
    throw new Error('Production catalog configuration requires an explicit HTTPS URL and production_configured=true.');
  }
  const response = await fetch(catalogUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Index catalog HTTP ${response.status}.`);
  const catalog = validateIndexCatalog(await response.json(), { baseUrl: catalogUrl });
  if (config.environment === 'production') {
    for (const reference of catalog.references) {
      for (const artifact of [...reference.files, reference.annotation]) {
        if (new URL(artifact.url).protocol !== 'https:') throw new Error('Production index and annotation artifact URLs must use HTTPS.');
      }
    }
  }
  return { config: { ...config, catalog_url: catalogUrl.href }, catalog };
}
