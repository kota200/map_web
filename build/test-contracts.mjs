import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inspectBrowserCapabilities, formatCapabilityBytes } from '../js/browser-capabilities.mjs';

const schemaPaths = [
  'contracts/sample.schema.json',
  'contracts/analysis-job.schema.json',
  'contracts/result-manifest.schema.json',
  'contracts/runtime-event.schema.json',
  'contracts/cancel-request.schema.json',
];

for (const path of schemaPaths) {
  const schema = JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.ok(schema.$id.includes('/contracts/'));
}

const readyEnv = {
  WebAssembly: {},
  Worker: function Worker() {},
  SharedArrayBuffer: function SharedArrayBuffer() {},
  DecompressionStream: function DecompressionStream() {},
  crossOriginIsolated: true,
  crypto: { subtle: { digest() {} } },
  navigator: {
    userAgent: 'test-browser',
    hardwareConcurrency: 8,
    storage: {
      async estimate() { return { quota: 4 * 1024 ** 3, usage: 1024 ** 3 }; },
      async getDirectory() {},
    },
  },
};

const ready = await inspectBrowserCapabilities(readyEnv, {
  kallistoRuntimeReady: true,
  hisat2EngineAvailable: false,
});
assert.equal(ready.workflows.kallisto.supported, true);
assert.equal(ready.workflows.hisat2_browser.supported, false);
assert.match(ready.workflows.hisat2_browser.missing.join(' '), /validated HISAT2/);
assert.equal(ready.storage.available_bytes, 3 * 1024 ** 3);

const unsupported = await inspectBrowserCapabilities({ navigator: {} });
assert.equal(unsupported.workflows.kallisto.supported, false);
assert.equal(unsupported.workflows.hisat2_browser.supported, false);
assert.equal(formatCapabilityBytes(1024 ** 3), '1.0 GiB');

console.log('Contract and browser capability tests passed.');
