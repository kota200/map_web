import { runFeatureCounts } from '../../featurecounts/runtime/featurecounts-runner.mjs';
import { getCachedReferenceFiles } from '../../w4-catalog/runtime/index-cache.mjs';
import { getReadyArtifact } from '../../w3-storage/runtime/opfs-artifact-store.mjs';

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

async function scanSam(file) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  const headerContigs = new Set();
  const mappedContigs = new Set();
  let mappedRecords = 0;
  let pending = '';
  const consume = (line) => {
    if (!line) return;
    if (line.startsWith('@SQ\t')) {
      const token = line.split('\t').find((field) => field.startsWith('SN:'));
      if (token) headerContigs.add(token.slice(3));
      return;
    }
    if (line.startsWith('@')) return;
    const fields = line.split('\t', 4);
    if (fields[2] && fields[2] !== '*') { mappedContigs.add(fields[2]); mappedRecords += 1; }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) consume(line);
  }
  pending += decoder.decode();
  consume(pending);
  return { headerContigs: [...headerContigs].sort(), mappedContigs: [...mappedContigs].sort(), mappedRecords };
}

function assignedCount(summary) {
  const line = String(summary).split(/\r?\n/).find((candidate) => candidate.startsWith('Assigned\t'));
  return line ? Number(line.split('\t')[1]) : NaN;
}

self.onmessage = async (event) => {
  const message = event.data;
  if (message?.type !== 'run') return;
  try {
    const { file: samFile } = await getReadyArtifact(message.samEntryId);
    const scan = await scanSam(samFile);
    const allowed = new Set(message.reference.annotation.contigs);
    const mismatched = scan.mappedContigs.filter((contig) => !allowed.has(contig));
    if (mismatched.length) {
      const error = new Error(`Mapped SAM contigs are absent from the annotation profile: ${mismatched.join(', ')}.`);
      error.name = 'ContigMismatchError';
      throw error;
    }
    const cached = await getCachedReferenceFiles(message.reference);
    const annotationFile = cached.files[message.reference.annotation.name];
    const annotation = new File([annotationFile], message.reference.annotation.name, { type: 'text/plain', lastModified: annotationFile.lastModified });
    const sam = new File([samFile], message.config.mode === 'pe' ? 'pe.sam' : 'se.sam', { type: 'text/plain', lastModified: samFile.lastModified });
    const result = await runFeatureCounts({ ...message.config, inputs: { ...message.config.inputs, sam, annotation } }, {
      onRunning(details) { post('running', details); },
      onStdout(line) { post('stdout', { line }); },
      onStderr(line) { post('stderr', { line }); },
    });
    if (result.exitCode === 0) {
      const assigned = assignedCount(result.outputs['featureCounts.txt.summary']);
      if (!Number.isFinite(assigned)) throw new Error('featureCounts summary does not contain a finite Assigned count.');
      if (assigned === 0) {
        const error = new Error(`featureCounts assigned 0 of ${scan.mappedRecords} mapped SAM records; check assembly, contigs, feature type, grouping attribute, and strandedness.`);
        error.name = 'ZeroAssignedError';
        throw error;
      }
    }
    post('result', { result: { ...result, contigCheck: { ...scan, annotationContigs: [...allowed], compatible: true } } });
  } catch (error) {
    post('error', { name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack || null });
  }
};
