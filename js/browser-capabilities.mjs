const mib = 1024 * 1024;

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function formatCapabilityBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unavailable';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export async function inspectBrowserCapabilities(
  env = globalThis,
  { kallistoRuntimeReady = false, hisat2EngineAvailable = false } = {},
) {
  const nav = env.navigator || {};
  const storage = nav.storage || {};
  let estimate = {};
  let estimateError = null;
  if (typeof storage.estimate === 'function') {
    try {
      estimate = await storage.estimate();
    } catch (error) {
      estimateError = String(error);
    }
  }

  const checks = [
    { id: 'webassembly', label: 'WebAssembly', ok: typeof env.WebAssembly === 'object', requiredFor: ['kallisto', 'hisat2'] },
    { id: 'worker', label: 'Web Workers', ok: typeof env.Worker === 'function', requiredFor: ['kallisto', 'hisat2'] },
    { id: 'cross-origin-isolation', label: 'Cross-origin isolation', ok: env.crossOriginIsolated === true, requiredFor: ['kallisto', 'hisat2'] },
    { id: 'shared-array-buffer', label: 'SharedArrayBuffer / pthreads', ok: typeof env.SharedArrayBuffer === 'function', requiredFor: ['kallisto', 'hisat2'] },
    { id: 'sha256', label: 'SHA-256 verification', ok: typeof env.crypto?.subtle?.digest === 'function', requiredFor: ['hisat2'] },
    { id: 'storage-estimate', label: 'Storage quota estimate', ok: typeof storage.estimate === 'function' && !estimateError, requiredFor: ['hisat2'] },
    { id: 'opfs', label: 'Origin private file system', ok: typeof storage.getDirectory === 'function', requiredFor: ['hisat2'] },
    { id: 'gzip-stream', label: 'Gzip preflight stream', ok: typeof env.DecompressionStream === 'function', requiredFor: [] },
  ];

  const missingFor = (engine) => checks
    .filter((check) => check.requiredFor.includes(engine) && !check.ok)
    .map((check) => check.label);
  const kallistoMissing = missingFor('kallisto');
  if (!kallistoRuntimeReady) kallistoMissing.push('kallisto Memory64 runtime compile');
  const hisat2Missing = missingFor('hisat2');
  if (!hisat2EngineAvailable) hisat2Missing.push('validated HISAT2/featureCounts Wasm engines');

  const quotaBytes = finiteOrNull(estimate.quota);
  const usageBytes = finiteOrNull(estimate.usage);
  const availableBytes = quotaBytes != null && usageBytes != null ? Math.max(0, quotaBytes - usageBytes) : null;

  return {
    schema_version: 1,
    checked_at: new Date().toISOString(),
    user_agent: typeof nav.userAgent === 'string' ? nav.userAgent : 'unavailable',
    hardware_concurrency: Number.isInteger(nav.hardwareConcurrency) ? nav.hardwareConcurrency : 'unavailable',
    checks,
    storage: {
      quota_bytes: quotaBytes ?? 'unavailable',
      usage_bytes: usageBytes ?? 'unavailable',
      available_bytes: availableBytes ?? 'unavailable',
      estimate_error: estimateError,
      warning_threshold_bytes: 512 * mib,
    },
    workflows: {
      kallisto: {
        supported: kallistoMissing.length === 0,
        missing: kallistoMissing,
      },
      hisat2_browser: {
        supported: hisat2Missing.length === 0,
        experimental: true,
        engine_available: hisat2EngineAvailable,
        missing: hisat2Missing,
      },
    },
  };
}
