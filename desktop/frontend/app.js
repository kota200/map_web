const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map((item) => [item.id, item]));
let activeRunId = null;
let pollTimer = null;

initializeSidecars();

for (const button of document.querySelectorAll('.engine')) {
  button.addEventListener('click', () => selectEngine(button.dataset.engine));
}

function selectEngine(engine) {
  elements.engine.value = engine;
  for (const button of document.querySelectorAll('.engine')) {
    button.setAttribute('aria-pressed', String(button.dataset.engine === engine));
  }
  const kallisto = engine === 'kallisto';
  elements['kallisto-fields'].hidden = !kallisto;
  elements['hisat-fields'].hidden = kallisto;
  elements['form-title'].textContent = kallisto ? 'Native Kallisto 0.52.0' : 'Native HISAT2 2.2.3 + featureCounts 2.1.1';
  elements['form-help'].textContent = kallisto
    ? 'Use a Kallisto transcriptome index. For single-end reads, mean fragment length and standard deviation are required.'
    : 'Use an eight-part HISAT2 genome index plus a matching GTF/GFF3 annotation. Keep SAM is off by default because SAM can be very large.';
  elements['index-label-text'].textContent = kallisto
    ? 'Kallisto transcriptome index — absolute local path'
    : 'HISAT2 genome index prefix — absolute local path';
  elements['index-path'].placeholder = kallisto ? 'C:\\references\\transcripts.idx' : 'C:\\references\\genome';
  elements.annotation.required = !kallisto;
}

elements['run-form'].addEventListener('submit', async (event) => {
  event.preventDefault();
  if (activeRunId) return;
  try {
    const request = buildRequest();
    const command = elements.engine.value === 'kallisto' ? 'start_kallisto_run' : 'start_hisat2_run';
    elements.logs.textContent = '';
    setStatus('Verifying registered sidecars and queueing the run…');
    const status = await invoke(command, { request });
    activeRunId = status.run_id;
    elements.cancel.hidden = false;
    setStatus(`${status.state}: ${status.detail}`);
    pollTimer = window.setInterval(pollStatus, 750);
  } catch (error) {
    setStatus(`Not started: ${String(error)}`);
  }
});

elements.cancel.addEventListener('click', async () => {
  if (!activeRunId) return;
  try {
    const status = await invoke('cancel_run', { runId: activeRunId });
    setStatus(`${status.state}: ${status.detail}`);
  } catch (error) {
    setStatus(`Cancellation failed: ${String(error)}`);
  }
});

listen('native-log', ({ payload }) => {
  if (payload.run_id !== activeRunId) return;
  const next = `[${payload.tool}/${payload.stream}] ${payload.line}\n`;
  elements.logs.textContent = `${elements.logs.textContent}${next}`.slice(-48_000);
  elements.logs.scrollTop = elements.logs.scrollHeight;
});

function buildRequest() {
  const sample = {
    name: elements['sample-name'].value.trim(),
    r1: elements.r1.value.trim(),
    r2: elements.r2.value.trim() || null,
  };
  const common = {
    sample,
    output_dir: elements['output-dir'].value.trim(),
    threads: Number(elements.threads.value),
    run_fastp: elements.fastp.checked,
  };
  if (elements.engine.value === 'kallisto') {
    const singleEnd = !sample.r2;
    return {
      ...common,
      index: elements['index-path'].value.trim(),
      fragment_length: singleEnd && elements['fragment-length'].value ? Number(elements['fragment-length'].value) : null,
      fragment_length_sd: singleEnd && elements['fragment-sd'].value ? Number(elements['fragment-sd'].value) : null,
      bootstrap_samples: Number(elements.bootstraps.value),
      bias: elements.bias.checked,
    };
  }
  return {
    ...common,
    index_prefix: elements['index-path'].value.trim(),
    annotation: elements.annotation.value.trim(),
    strandedness: Number(elements.strandedness.value),
    feature_type: 'exon',
    grouping_attribute: 'gene_id',
    keep_sam: elements['keep-sam'].checked,
  };
}

async function pollStatus() {
  if (!activeRunId) return;
  try {
    const status = await invoke('get_run_status', { runId: activeRunId });
    if (!status) return;
    setStatus(`${status.state}: ${status.detail}`);
    if (['completed', 'failed', 'cancelled'].includes(status.state)) finishPolling();
  } catch (error) {
    setStatus(`Status check failed: ${String(error)}`);
    finishPolling();
  }
}

function finishPolling() {
  window.clearInterval(pollTimer);
  pollTimer = null;
  activeRunId = null;
  elements.cancel.hidden = true;
}

function setStatus(message) {
  elements.status.textContent = message;
}

async function initializeSidecars() {
  try {
    const statuses = await invoke('verify_sidecars');
    const valid = new Map(statuses.map((status) => [status.tool, status.valid]));
    const kallistoButton = document.querySelector('[data-engine="kallisto"]');
    const hisatButton = document.querySelector('[data-engine="hisat2"]');
    kallistoButton.disabled = !valid.get('Kallisto');
    hisatButton.disabled = !(valid.get('Hisat2') && valid.get('FeatureCounts'));
    elements.fastp.disabled = !valid.get('Fastp');
    if (elements.fastp.disabled) elements.fastp.checked = false;
    if (kallistoButton.disabled && !hisatButton.disabled) selectEngine('hisat2');
    if (kallistoButton.disabled && hisatButton.disabled) {
      elements['run-button'].disabled = true;
      setStatus('No complete analysis engine is installed for this platform. The fail-closed sidecar check blocked execution.');
    } else {
      elements['run-button'].disabled = false;
      setStatus('Sidecar checks complete. Only verified engines are enabled.');
    }
  } catch (error) {
    for (const button of document.querySelectorAll('.engine')) button.disabled = true;
    elements['run-button'].disabled = true;
    setStatus(`Sidecar verification failed: ${String(error)}`);
  }
}
