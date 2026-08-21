import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const index = read('index.html');
const help = read('help.html');
const app = read('js/app.js');
const hisatPage = read('hisat2-workflow.html');
const hisatUi = read('js/hisat2-workflow.mjs');

assert.match(index, /Kallisto in browser/);
assert.match(index, /HISAT2 \+ featureCounts in browser/);
assert.match(index, /href="\.\/hisat2-workflow\.html">Open experimental workflow<\/a>/);
assert.match(index, /href="\.\/reference-cache\.html">Manage hosted reference cache<\/a>/);
assert.match(index, /Desktop is not released/);
assert.match(index, /transcript-level quantification/);
assert.match(index, /gene-level raw counts, Length, and gene TPM/);
assert.match(index, /connect-src 'self'/);
assert.doesNotMatch(index, /https?:\/\//);

assert.match(help, /Kallisto in browser/);
assert.match(help, /transcript TPM must not be presented as the same quantity as a gene TPM/);
assert.match(help, /No telemetry is added by this build/);
assert.match(help, /HISAT2 Web Limits and Desktop Recommendation/);
assert.match(help, /at or above 1\.5 GiB is rejected/);
assert.match(help, /compressed input at or above 2 GiB/);
assert.match(help, /fastp defaults OFF/);

assert.match(app, /inspectBrowserCapabilities/);
assert.match(app, /hisat2EngineAvailable: true/);
assert.match(app, /production-scale W6 validation is pending/);
assert.match(index, /id="runKallistoFastp"/);
assert.doesNotMatch(index.match(/id="runKallistoFastp"[^>]*>/)?.[0] || '', /checked/);
assert.match(app, /new KallistoFastpPreprocessor/);
assert.match(app, /cleanupKallistoFastp/);

assert.match(hisatPage, /HISAT2 \+ featureCounts in your browser/);
assert.match(hisatPage, /optional; default OFF/);
assert.match(hisatPage, /\.fastq, \.fq, \.fastq\.gz, \.fq\.gz/);
assert.match(hisatPage, /Temporary decompressed FASTQ and SAM files are removed automatically/);
assert.match(hisatPage, /Web storage and scale preflight/);
assert.match(hisatUi, /new Hisat2WebRunner/);
assert.match(hisatUi, /materializeOutput/);
assert.match(hisatUi, /deleteRetainedArtifacts/);
assert.match(hisatUi, /buildFastpArguments/);
assert.match(hisatUi, /buildHisat2Arguments/);
assert.match(hisatUi, /buildFeatureCountsArguments/);
assert.match(hisatUi, /threads: Number\(elements\.threads\.value\)/);
assert.match(hisatUi, /assertHisat2WebResources/);
assert.match(hisatUi, /estimateHisat2WebResources/);

const cachePage = read('reference-cache.html');
const cacheUi = read('js/reference-cache.mjs');
assert.match(cachePage, /Download \/ verify cache/);
assert.match(cachePage, /Delete cached reference/);
assert.match(cachePage, /Selected reference cache/);
assert.match(cacheUi, /loadConfiguredCatalog/);
assert.match(cacheUi, /client\.request\('download'/);
assert.match(cacheUi, /client\.request\('delete'/);

console.log('Web product shell tests passed.');
