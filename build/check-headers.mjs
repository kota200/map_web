import assert from 'node:assert/strict';

const baseUrl = (process.argv[2] || 'http://127.0.0.1:8000/').replace(/\/?$/, '/');
for (const path of ['', 'kallisto/kallisto.wasm']) {
  const response = await fetch(new URL(path, baseUrl), { cache: 'no-store' });
  assert.equal(response.ok, true, `${path || 'index.html'} returned HTTP ${response.status}`);
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  if (path.endsWith('.wasm')) {
    assert.match(response.headers.get('content-type') || '', /^application\/wasm(?:;|$)/);
  }
}

console.log(`Deployment header check passed for ${baseUrl}`);
