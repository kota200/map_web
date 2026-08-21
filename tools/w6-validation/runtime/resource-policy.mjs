const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export const WEB_RESOURCE_LIMITS = Object.freeze({
  hisat2WasmMaximumBytes: 2 * GIB,
  featureCountsWasmMaximumBytes: 2 * GIB,
  conservativeIndexPayloadBytes: Math.floor(1.5 * GIB),
  storageHeadroomBytes: 256 * MIB,
  desktopInputRecommendationBytes: 2 * GIB,
});

function fileBytes(samples = []) {
  return samples.reduce((total, sample) => {
    const inputs = [...(sample.read1 || sample.single || sample.r1 || []), ...(sample.read2 || sample.r2 || [])];
    return total + inputs.reduce((sum, file) => sum + Number(file?.size || file?.size_bytes || 0), 0);
  }, 0);
}

function hasGzip(samples = []) {
  return samples.some((sample) => [...(sample.read1 || sample.single || sample.r1 || []), ...(sample.read2 || sample.r2 || [])]
    .some((file) => /\.gz$/i.test(file?.name || file?.basename || '')));
}

export function estimateHisat2WebResources({ referenceBytes = 0, samples = [], runFastp = false, availableBytes = null } = {}) {
  const inputBytes = fileBytes(samples);
  const gzip = hasGzip(samples);
  const decompressedFastqBytes = gzip ? inputBytes * 4 : 0;
  const cleanedFastqBytes = runFastp ? inputBytes * (gzip ? 4 : 1.25) : 0;
  const samBytes = inputBytes * (gzip ? 6 : 2);
  const temporaryBytes = Math.ceil(decompressedFastqBytes + cleanedFastqBytes + samBytes);
  const requiredStorageBytes = Math.ceil(Number(referenceBytes || 0) + temporaryBytes + WEB_RESOURCE_LIMITS.storageHeadroomBytes);
  const warnings = [];
  const errors = [];
  if (referenceBytes >= WEB_RESOURCE_LIMITS.conservativeIndexPayloadBytes) {
    errors.push(`Hosted index payload ${referenceBytes} bytes exceeds the validated Web reference envelope.`);
  }
  if (Number.isFinite(availableBytes) && availableBytes < requiredStorageBytes) {
    errors.push(`Estimated storage requirement ${requiredStorageBytes} bytes exceeds ${availableBytes} available bytes.`);
  }
  if (inputBytes >= WEB_RESOURCE_LIMITS.desktopInputRecommendationBytes || temporaryBytes >= WEB_RESOURCE_LIMITS.desktopInputRecommendationBytes) {
    warnings.push('This dataset is beyond the measured small Web envelope; use the verified desktop workflow for larger or long-running analysis.');
  }
  warnings.push('FASTQ expansion and SAM size are conservative heuristics, not measured percentages or a storage guarantee.');
  return {
    inputBytes,
    referenceBytes: Number(referenceBytes || 0),
    gzip,
    decompressedFastqBytes,
    cleanedFastqBytes,
    samBytes,
    temporaryBytes,
    requiredStorageBytes,
    availableBytes: Number.isFinite(availableBytes) ? availableBytes : null,
    supported: errors.length === 0,
    recommendDesktop: inputBytes >= WEB_RESOURCE_LIMITS.desktopInputRecommendationBytes || temporaryBytes >= WEB_RESOURCE_LIMITS.desktopInputRecommendationBytes,
    warnings,
    errors,
  };
}

export function assertHisat2WebResources(input) {
  const estimate = estimateHisat2WebResources(input);
  if (!estimate.supported) {
    const error = new Error(`Web resource preflight failed: ${estimate.errors.join(' ')}`);
    error.name = estimate.errors.some((message) => /storage/.test(message)) ? 'QuotaPreflightError' : 'WebResourceLimitError';
    error.estimate = estimate;
    throw error;
  }
  return estimate;
}
