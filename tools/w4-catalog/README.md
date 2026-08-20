# Phase W4 hosted HISAT2 index catalog

W4 defines and validates a hosted, immutable HISAT2 index package without running `hisat2-build` in the browser. The repository intentionally configures only a local test catalog. No placeholder production URL is presented as real.

## Configuration and contract

- `config/index-catalog.json` is the explicit environment switch and catalog URL.
- `contracts/index-catalog.schema.json` is the machine-readable schema.
- `test-data/index-catalog/catalog.v1.test.json` describes the existing synthetic `chrTiny` index and GTF, including exact HISAT2 version, build arguments, sizes, SHA-256 values, sources, licenses, contigs, and creation time.

Production configuration must set `environment` to `production`, use an explicit HTTPS catalog URL, and set `production_configured` to `true`. Catalog and artifact URLs should be immutable/versioned. Same-origin delivery is the initial deployment model; a future CDN must preserve COOP/COEP compatibility and provide suitable CORS/CORP headers.

## Browser cache rules

`runtime/cache-worker.mjs` owns network streaming, incremental SHA-256, and OPFS synchronous access handles. The main thread exchanges only manifest/progress/result objects.

- The cache key covers the manifest reference ID, exact HISAT2 version, and every index/annotation checksum.
- Downloads are persisted with writes bounded to 1 MiB by default.
- Size and SHA-256 must both match before `ready.json` is written.
- `partial.json` entries are never treated as ready and are deleted during recovery.
- Annotation contigs are scanned after download and checked against the index manifest.
- Quota is estimated before download; usage and explicit delete/freed-byte primitives are exposed.
- A failed integrity check deletes the entire reference entry. Cancellation uses Worker termination; the next worker removes the partial entry and can retry.

## Gates

```powershell
& '<bundled-node>' tools/w4-catalog/tests/static-contract.mjs
& '<bundled-python>' build/serve.py --port 8765
```

Open `/tools/w4-catalog/tests/browser-catalog-gate.html`. The browser gate performs an interrupted download, recovery, retry, page reload, full re-hash, same-size corruption, catalog/checksum mismatch, cache usage listing, and deletion. It leaves no W4 test reference data in OPFS.
