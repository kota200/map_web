# Phase W3 browser storage gate

This directory contains the measured large-file architecture boundary. It is an integration harness, not a product UI.

## Selected boundary

- User-selected `File`/`Blob` and committed OPFS `File` snapshots are mounted read-only through WORKERFS.
- Hosted artifacts are fetched inside a storage Worker and persisted to OPFS in bounded writes.
- fastp cleaned FASTQ and HISAT2 SAM are written from Emscripten's synchronous POSIX output path into an OPFS `FileSystemSyncAccessHandle` through a character-device adapter.
- Separate tool Workers exchange only `{ schemaVersion, entryId }`; the receiving Worker reopens the committed OPFS file.
- A `state.json` ready marker is written only after close, size validation, and flush. Missing or invalid markers are deleted during recovery.

The current proof uses one OPFS entry per artifact. Multi-part, checksum-addressed index cache entries are Phase W4.

## Browser gate

Serve the application with isolation headers and open:

```text
http://127.0.0.1:8000/tools/w3-storage/tests/browser-gate.html
```

The page intentionally reloads once. It measures a generated 64 MiB artifact without committing that fixture to the repository, verifies cross-Worker persistence and checksum, tests quota rejection, streams a static index part, runs file-backed fastp/HISAT2/featureCounts boundaries, terminates a Worker during a 256 MiB write, recovers the incomplete entry, and removes all test entries.

Run the dependency-free static contract with:

```text
node tools/w3-storage/tests/static-contract.mjs
```

Production-scale biological indexes and FASTQ remain outside this proof and require separately checksummed benchmark inputs.
