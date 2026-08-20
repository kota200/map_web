# Baseline Provenance

## Archive

- Original path: `C:\Users\0314k\Desktop\kallisto-web.zip`
- SHA-256: `BD0423DF5BA37D4324EEF66119805E87286C0FCDCC432B76E6B6EDEE56764FE5`
- Archive entries: 1,503
- Extraction target: `mapping_app/kallisto-web/`
- The original ZIP was read and extracted; it was not modified.

The workspace was empty and was not a Git repository before extraction. Therefore there was no root working-tree status or pre-existing workspace change to preserve. The nested `vendor/kallisto` checkout is a Git repository at upstream `v0.52.0`, commit `4e9f29cf3b021260415430c057a22469ca081391`, with ten intentionally modified files produced by the Wasm port.

## Archived runtime hashes

- `kallisto/kallisto.js`: `2345D8EBBE7D085ACA542586FABDA3E8BEA105294CC2E19398A3A02B84A2B77F`
- `kallisto/kallisto.wasm`: `A0C5E90BD8ABC2C09E3126F2C7CCE1616E31EACDDDF5046FDF36CABB81AEE5AD`

## Fixture hashes

- `transcripts.fa`: `E7BA14E2325961F2BFFF67F60275F1A299F87C08D67EBDD0699B5D825FE3593A`
- `reads_R1.fastq`: `9F9EC8E55BE17E0FF49EB8EE9160F0C4CC694BB2B8F591C6B353BE489527795C`
- `reads_R2.fastq`: `07F796A9273F935BE1DFF761C09CF53632BA67C0AE1E937031A3B52056D8BFAA`
- `reads_R2_short.fastq`: `711CDF853584C84D3E77576E29D75F2CF3FA625710ADB40209A41DDBE5104816`

## Pre-change browser observation

On 2026-08-14, before W1 source edits, the packaged Wasm runtime was exercised from the actual app through a Chromium-based in-app browser with COOP/COEP enabled:

- Runtime reported ready with Memory64, SIMD128, LTO, zlib-ng, and pthreads.
- Tiny index build completed and produced 2,012 bytes.
- Tiny generated index SHA-256: `AA60882D699ED4F66061F3C0612D58DD4552ABC4AC54DD24E628646E30614BCC`.
- Paired quantification processed 2 fragments and pseudoaligned 2.
- `tx1`: length 72, effective length 41, estimated count 1, TPM 500,000.
- `tx2`: length 72, effective length 41, estimated count 1, TPM 500,000.
- `counts_matrix.tsv` and `tpm_matrix.tsv` matched the values archived in `test-data/golden/`.

Runtime timing was observed but deliberately excluded from the scientific golden baseline.
