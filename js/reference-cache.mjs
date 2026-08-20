import { loadConfiguredCatalog } from './index-catalog.mjs';
import { W4IndexCacheClient } from '../tools/w4-catalog/runtime/cache-client.mjs';

const elements = {
  catalogNotice: document.querySelector('#catalogNotice'),
  select: document.querySelector('#referenceSelect'),
  assembly: document.querySelector('#referenceAssembly'),
  hisat2: document.querySelector('#referenceHisat2'),
  annotation: document.querySelector('#referenceAnnotation'),
  payload: document.querySelector('#referencePayload'),
  cacheButton: document.querySelector('#cacheReference'),
  deleteButton: document.querySelector('#deleteReference'),
  refreshButton: document.querySelector('#refreshCache'),
  progress: document.querySelector('#cacheProgress'),
  progressText: document.querySelector('#cacheProgressText'),
  selectedUsage: document.querySelector('#selectedCacheUsage'),
  browserUsage: document.querySelector('#browserUsage'),
  browserAvailable: document.querySelector('#browserAvailable'),
  cacheState: document.querySelector('#cacheState'),
  status: document.querySelector('#cacheStatus'),
};

let client = null;
let references = [];
let selectedReference = null;
let selectedCacheKey = null;
let busy = false;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'Unavailable';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

function setStatus(message, state = 'idle') {
  elements.status.textContent = message;
  elements.status.dataset.state = state;
}

function updateControls(hasReady = false) {
  elements.select.disabled = busy || references.length === 0;
  elements.cacheButton.disabled = busy || !selectedReference;
  elements.deleteButton.disabled = busy || !hasReady;
  elements.refreshButton.disabled = busy || !selectedReference;
}

function showProgress(progress) {
  const completed = Number(progress.completedBytes ?? 0);
  const total = Number(progress.totalBytes ?? selectedReference?.total_size ?? 0);
  elements.progress.max = Math.max(1, total);
  elements.progress.value = Math.min(completed, total);
  const verb = progress.stage === 'verify' ? 'Verifying' : progress.stage === 'download' ? 'Downloading' : 'Preparing';
  const file = progress.file ? ` ${progress.file}` : '';
  elements.progressText.textContent = `${verb}${file}: ${formatBytes(completed)} / ${formatBytes(total)}`;
}

function showReference(reference) {
  selectedReference = reference;
  elements.assembly.textContent = `${reference.organism} · ${reference.assembly}`;
  elements.hisat2.textContent = `${reference.hisat2_version} · ${reference.index_format}`;
  elements.annotation.textContent = `${reference.annotation.format} ${reference.annotation.version} · ${reference.annotation.default_feature_type}/${reference.annotation.default_grouping_attribute}`;
  elements.payload.textContent = `${formatBytes(reference.total_size)} across ${reference.files.length + 1} files`;
  elements.progress.max = Math.max(1, reference.total_size);
  elements.progress.value = 0;
  elements.progressText.textContent = 'Idle';
}

async function refreshUsage() {
  if (!selectedReference) return;
  const [{ cacheKey }, estimate, entries] = await Promise.all([
    client.request('cache-key', { reference: selectedReference }),
    client.request('estimate-reference', { reference: selectedReference, headroomBytes: 0 }),
    client.request('list'),
  ]);
  selectedCacheKey = cacheKey;
  const entry = entries.find((candidate) => candidate.cacheKey === cacheKey);
  elements.selectedUsage.textContent = entry ? formatBytes(entry.sizeBytes) : 'Not cached';
  elements.browserUsage.textContent = formatBytes(estimate.usageBytes);
  elements.browserAvailable.textContent = formatBytes(estimate.availableBytes);
  elements.cacheState.textContent = entry?.status === 'ready' ? 'Ready and reusable' : entry ? 'Incomplete / invalid' : 'Not cached';
  updateControls(entry?.status === 'ready');
  return { entry, estimate };
}

async function withBusy(operation) {
  busy = true;
  updateControls(false);
  try { return await operation(); }
  finally { busy = false; }
}

elements.select.addEventListener('change', async () => {
  showReference(references[Number(elements.select.value)]);
  try { await refreshUsage(); } catch (error) { setStatus(error.message || String(error), 'error'); }
});

elements.refreshButton.addEventListener('click', async () => {
  await withBusy(async () => {
    setStatus('Refreshing cache usage…');
    const { entry } = await refreshUsage();
    setStatus(entry?.status === 'ready' ? 'Cached reference is ready.' : 'Reference is not cached.', 'success');
  }).catch((error) => setStatus(error.message || String(error), 'error'));
  await refreshUsage().catch(() => {});
});

elements.cacheButton.addEventListener('click', async () => {
  await withBusy(async () => {
    setStatus('Downloading or verifying every hosted artifact…');
    elements.progress.value = 0;
    const result = await client.request('download', { reference: selectedReference }, showProgress);
    elements.progress.value = selectedReference.total_size;
    elements.progressText.textContent = `Complete: ${formatBytes(selectedReference.total_size)} verified`;
    setStatus(result.alreadyReady ? 'Existing cache was fully re-verified.' : 'Reference downloaded and committed to OPFS.', 'success');
  }).catch((error) => setStatus(`${error.name || 'Error'}: ${error.message || error}`, 'error'));
  await refreshUsage().catch(() => {});
});

elements.deleteButton.addEventListener('click', async () => {
  await withBusy(async () => {
    setStatus('Deleting the selected reference cache…');
    const result = await client.request('delete', { cacheKey: selectedCacheKey });
    elements.progress.value = 0;
    elements.progressText.textContent = 'Idle';
    setStatus(result.removed ? `Deleted ${formatBytes(result.freedBytes)} from local browser storage.` : 'The selected reference was already absent.', 'success');
  }).catch((error) => setStatus(error.message || String(error), 'error'));
  await refreshUsage().catch(() => {});
});

try {
  if (!crossOriginIsolated || typeof navigator.storage?.getDirectory !== 'function') throw new Error('This browser does not provide the required cross-origin-isolated OPFS environment.');
  client = new W4IndexCacheClient();
  const recovery = await client.request('recover');
  const { config, catalog } = await loadConfiguredCatalog();
  references = catalog.references;
  elements.catalogNotice.textContent = config.production_configured
    ? `Production catalog: ${references.length} reference package(s).`
    : `Local test catalog only: ${references.length} synthetic package(s). No production catalog is configured.`;
  for (const [index, reference] of references.entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = reference.display_name;
    elements.select.append(option);
  }
  showReference(references[0]);
  const { entry } = await refreshUsage();
  const recoveryMessage = recovery.removed.length ? ` Removed ${recovery.removed.length} incomplete cache entr${recovery.removed.length === 1 ? 'y' : 'ies'}.` : '';
  setStatus(`${entry?.status === 'ready' ? 'Selected reference is cached.' : 'Selected reference is not cached.'}${recoveryMessage}`, 'success');
} catch (error) {
  setStatus(error.message || String(error), 'error');
  elements.catalogNotice.textContent = 'Catalog/cache initialization failed.';
  updateControls(false);
}

window.addEventListener('pagehide', () => client?.close(), { once: true });
