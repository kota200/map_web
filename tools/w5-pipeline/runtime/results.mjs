function normalizedLines(text) {
  return String(text).trim().split(/\r?\n/).filter(Boolean);
}

export function parseFeatureCounts(text) {
  const lines = normalizedLines(text).filter((line) => !line.startsWith('#'));
  if (lines.length < 2) throw new Error('featureCounts output contains no gene rows.');
  const header = lines[0].split('\t');
  if (header.length < 7 || header[0] !== 'Geneid' || !header.includes('Length')) throw new Error('featureCounts output header is invalid.');
  const rows = lines.slice(1).map((line, index) => {
    const fields = line.split('\t');
    if (fields.length !== header.length) throw new Error(`featureCounts row ${index + 1} has ${fields.length} fields; expected ${header.length}.`);
    const length = Number(fields[5]);
    const count = Number(fields.at(-1));
    if (!fields[0]) throw new Error(`featureCounts row ${index + 1} has an empty Geneid.`);
    if (!Number.isFinite(length) || length <= 0) throw new Error(`${fields[0]}: Length must be a positive finite value.`);
    if (!Number.isFinite(count) || count < 0) throw new Error(`${fields[0]}: count must be a non-negative finite value.`);
    return { geneId: fields[0], length, count };
  });
  if (new Set(rows.map((row) => row.geneId)).size !== rows.length) throw new Error('featureCounts output contains duplicate Geneid values.');
  return rows;
}

export function parseAssignmentSummary(text) {
  const lines = normalizedLines(text);
  if (lines.length < 2 || !lines[0].startsWith('Status\t')) throw new Error('featureCounts assignment summary is invalid.');
  return Object.fromEntries(lines.slice(1).map((line) => {
    const [status, raw] = line.split('\t');
    const value = Number(raw);
    if (!status || !Number.isFinite(value) || value < 0) throw new Error(`Invalid featureCounts summary row: ${line}`);
    return [status, value];
  }));
}

export function calculateTpm(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('TPM calculation requires at least one gene row.');
  const rates = rows.map((row) => {
    if (!Number.isFinite(row.length) || row.length <= 0) throw new Error(`${row.geneId}: Length must be positive for TPM.`);
    if (!Number.isFinite(row.count) || row.count < 0) throw new Error(`${row.geneId}: count must be non-negative for TPM.`);
    return row.count / row.length;
  });
  const denominator = rates.reduce((sum, rate) => sum + rate, 0);
  if (!Number.isFinite(denominator)) throw new Error('TPM denominator is not finite.');
  if (denominator === 0) {
    return { rows: rows.map((row) => ({ ...row, tpm: 0 })), denominator, warnings: ['All count/Length rates are zero; TPM values were set to 0.'] };
  }
  return {
    rows: rows.map((row, index) => ({ ...row, tpm: rates[index] / denominator * 1_000_000 })),
    denominator,
    warnings: [],
  };
}

function formatNumber(value) {
  if (Number.isInteger(value)) return String(value);
  return Number(value).toPrecision(15).replace(/(?:\.0+|(?:(\.\d*?[1-9]))0+)$/, '$1');
}

export function countsTsv(rows) {
  return `Geneid\tLength\tCount\n${rows.map((row) => `${row.geneId}\t${formatNumber(row.length)}\t${formatNumber(row.count)}`).join('\n')}\n`;
}

export function countsWithTpmTsv(rows) {
  return `Geneid\tLength\tCount\tTPM\n${rows.map((row) => `${row.geneId}\t${formatNumber(row.length)}\t${formatNumber(row.count)}\t${formatNumber(row.tpm)}`).join('\n')}\n`;
}

export function buildMatrices(sampleResults) {
  if (!Array.isArray(sampleResults) || sampleResults.length < 2) throw new Error('Matrices require at least two completed samples.');
  const baseline = sampleResults[0].tpmRows;
  for (const sample of sampleResults.slice(1)) {
    if (sample.tpmRows.length !== baseline.length) throw new Error(`${sample.name}: gene row count differs from the first sample.`);
    for (let index = 0; index < baseline.length; index += 1) {
      if (sample.tpmRows[index].geneId !== baseline[index].geneId || sample.tpmRows[index].length !== baseline[index].length) {
        throw new Error(`${sample.name}: Geneid/Length/order differs at row ${index + 1}.`);
      }
    }
  }
  const header = `Geneid\tLength\t${sampleResults.map((sample) => sample.name).join('\t')}\n`;
  const countRows = baseline.map((row, index) => `${row.geneId}\t${formatNumber(row.length)}\t${sampleResults.map((sample) => formatNumber(sample.tpmRows[index].count)).join('\t')}`).join('\n');
  const tpmRows = baseline.map((row, index) => `${row.geneId}\t${formatNumber(row.length)}\t${sampleResults.map((sample) => formatNumber(sample.tpmRows[index].tpm)).join('\t')}`).join('\n');
  return { counts: `${header}${countRows}\n`, tpm: `${header}${tpmRows}\n` };
}

export function summarizeFastp(report, elapsedMs) {
  const before = report?.summary?.before_filtering;
  const after = report?.summary?.after_filtering;
  const filtering = report?.filtering_result;
  const adapter = report?.adapter_cutting;
  if (!before || !after || !filtering) throw new Error('fastp JSON report lacks required QC fields.');
  return {
    version: report.fastp_version || report.summary?.fastp_version || '0.23.4',
    before: { reads: before.total_reads, bases: before.total_bases, q20Rate: before.q20_rate, q30Rate: before.q30_rate, gcContent: before.gc_content },
    after: { reads: after.total_reads, bases: after.total_bases, q20Rate: after.q20_rate, q30Rate: after.q30_rate, gcContent: after.gc_content },
    filtering: {
      passed: filtering.passed_filter_reads,
      lowQuality: filtering.low_quality_reads,
      tooManyN: filtering.too_many_N_reads,
      tooShort: filtering.too_short_reads,
      tooLong: filtering.too_long_reads,
    },
    adapter: { trimmedReads: adapter?.adapter_trimmed_reads ?? 0, trimmedBases: adapter?.adapter_trimmed_bases ?? 0 },
    elapsedMs,
  };
}
