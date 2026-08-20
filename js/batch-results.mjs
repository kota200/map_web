const REQUIRED_COLUMNS = ['target_id', 'est_counts', 'tpm'];

function decodeAbundance(buffer) {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error('abundance.tsv is not available as an ArrayBuffer.');
  }
  return new TextDecoder().decode(buffer);
}

function splitNonEmptyLines(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export class MatrixBuilder {
  constructor() {
    this.targetIds = null;
    this.targetIndex = null;
    this.samples = [];
  }

  addSample(sampleName, abundanceBuffer) {
    const lines = splitNonEmptyLines(decodeAbundance(abundanceBuffer));
    if (lines.length < 1) throw new Error(`${sampleName}: abundance.tsv is empty.`);

    const header = lines[0].split('\t');
    const columns = Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, header.indexOf(name)]));
    for (const name of REQUIRED_COLUMNS) {
      if (columns[name] < 0) throw new Error(`${sampleName}: abundance.tsv is missing the ${name} column.`);
    }

    const rowCount = lines.length - 1;
    if (this.targetIds && rowCount !== this.targetIds.length) {
      throw new Error(
        `${sampleName}: target count differs from the first sample ` +
        `(${rowCount} versus ${this.targetIds.length}); matrices were not generated.`
      );
    }

    const counts = new Array(rowCount);
    const tpm = new Array(rowCount);
    const seen = new Set();
    if (!this.targetIds) {
      this.targetIds = new Array(rowCount);
      this.targetIndex = new Map();
    }

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const fields = lines[rowIndex + 1].split('\t');
      const targetId = fields[columns.target_id];
      const countValue = fields[columns.est_counts];
      const tpmValue = fields[columns.tpm];
      if (!targetId) throw new Error(`${sampleName}: empty target_id at abundance.tsv row ${rowIndex + 2}.`);
      if (seen.has(targetId)) throw new Error(`${sampleName}: duplicate target_id ${targetId}.`);
      seen.add(targetId);
      if (!Number.isFinite(Number(countValue)) || !Number.isFinite(Number(tpmValue))) {
        throw new Error(`${sampleName}: non-numeric est_counts or TPM for target_id ${targetId}.`);
      }

      if (this.samples.length === 0) {
        this.targetIds[rowIndex] = targetId;
        this.targetIndex.set(targetId, rowIndex);
      } else {
        const expectedIndex = this.targetIndex.get(targetId);
        if (expectedIndex == null) {
          throw new Error(`${sampleName}: unknown target_id ${targetId}; matrices were not generated.`);
        }
        if (expectedIndex !== rowIndex || this.targetIds[rowIndex] !== targetId) {
          throw new Error(
            `${sampleName}: target order differs at row ${rowIndex + 2} ` +
            `(expected ${this.targetIds[rowIndex]}, found ${targetId}); matrices were not generated.`
          );
        }
      }
      // Preserve kallisto's exact decimal strings; estimated counts are not rounded.
      counts[rowIndex] = countValue;
      tpm[rowIndex] = tpmValue;
    }

    this.samples.push({ name: sampleName, counts, tpm });
  }

  toMatrices() {
    if (!this.targetIds || this.samples.length === 0) {
      throw new Error('No completed samples are available for matrix generation.');
    }
    const header = `target_id\t${this.samples.map((sample) => sample.name).join('\t')}\n`;
    let counts = header;
    let tpm = header;
    for (let i = 0; i < this.targetIds.length; i += 1) {
      let countRow = this.targetIds[i];
      let tpmRow = this.targetIds[i];
      for (const sample of this.samples) {
        countRow += `\t${sample.counts[i]}`;
        tpmRow += `\t${sample.tpm[i]}`;
      }
      counts += `${countRow}\n`;
      tpm += `${tpmRow}\n`;
    }
    return { counts, tpm };
  }

  release() {
    this.targetIds = null;
    this.targetIndex = null;
    this.samples = [];
  }
}
