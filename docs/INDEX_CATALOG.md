# Hosted HISAT2 Index Catalog

## Current configuration

`config/index-catalog.json` is the only catalog selection point. It currently selects `test-data/index-catalog/catalog.v1.test.json` with `environment: "local-test"` and `production_configured: false`. This is intentional: a production host has not been selected, so the repository does not advertise a placeholder URL.

The test package reuses the existing synthetic `chrTiny` files. It does not duplicate or commit a large biological index. The browser never runs `hisat2-build`.

## Manifest contract

`contracts/index-catalog.schema.json` requires each reference to record:

- stable reference ID, display name, organism, assembly, and contig lengths;
- exact HISAT2 version, index format, and native `hisat2-build` argument array;
- exactly eight `.ht2` or `.ht2l` components, each with immutable URL, byte size, and lowercase SHA-256;
- annotation URL, size, SHA-256, format/version, feature type, grouping attribute, and contigs;
- source URLs, licenses, and creation timestamp.

The local catalog records HISAT2 2.2.3 and the exact native fixture build arguments `--ss splice-sites.txt --exon exons.txt genome.fa tiny`. All nine hosted artifacts total 4,203,807 bytes.

## Cache transaction

The cache key is the reference ID plus a SHA-256 over the exact HISAT2 version and every index/annotation checksum. Files are streamed in a dedicated Worker, incrementally hashed, and written to OPFS in chunks of at most 1 MiB by default.

An entry starts with `partial.json`. Only after every size/SHA-256 check and the annotation-contig scan pass does the Worker write `ready.json` and remove the partial marker. A partial or invalid entry is never returned as ready. Existing ready data is re-hashed before reuse. A failure deletes the whole reference entry, avoiding mixed-version or mixed-generation files.

Worker termination is the cancellation boundary. A new Worker removes the interrupted entry during recovery, after which the same reference can be retried. The cache API also provides quota preflight, per-entry usage, explicit deletion, and reported freed bytes.

`reference-cache.html`, linked from the disabled experimental workflow card, is the operational cache UI. It downloads or fully re-verifies the selected package, shows reference/browser storage use and quota, and deletes the selected cache while reporting freed bytes. It does not enable analysis.

## Assembly and annotation policy

Catalog validation requires every declared annotation contig to exist in the reference manifest. After download, the GTF/GFF3 sequence column is scanned and compared with those declarations. A future advanced annotation-replacement UI must warn that assembly and contig naming must match, show the selected feature type/grouping attribute, and repeat this validation before featureCounts runs.

## Production activation gate

Production activation requires a real immutable/versioned HTTPS catalog URL, `environment: "production"`, and `production_configured: true`. Every artifact URL must also be HTTPS. The initial supported topology is same-origin.

If a CDN is introduced, validate all of the following against the actual deployed URLs before changing the configuration:

- application CSP `connect-src`;
- CORS response policy;
- `Cross-Origin-Resource-Policy` compatibility;
- continued `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` isolation;
- range/cache behavior, immutable naming, content length, and SHA-256;
- source attribution, redistribution licenses, assembly/annotation provenance, and availability.

W4 acceptance covers only the same-origin synthetic package in Chromium. Production-size genomes and a production hosting origin remain W6/release inputs.
