# Phase W6 handoff

Updated: 2026-08-21 (Asia/Tokyo)

This document is the working-state handoff for the next coding agent. Read it
before changing the repository. Phase W6 has made substantial progress, but it
is **not release-complete**.

## Repository state

- Repository: `kota200/map_web`
- Local path: `C:\Users\0314k\Desktop\mapping_app\kallisto-web`
- Current branch: `phase-w6-release-gate`
- Current/remote branch HEAD: `435b674b8782a7249037601ee69a08b0ac63cbc1`
- Synced `main` commit: `14668d75bbfcda567552ac544e2006c34cf241a7`
- `origin/main` is an ancestor of the W6 branch.
- No PR exists for `phase-w6-release-gate` as of this handoff.
- The only known dirty item is `vendor/kallisto` (`git status` shows
  `m vendor/kallisto`). This is the user's patched submodule checkout. **Do not
  reset, clean, stage, commit, or otherwise modify it.**

Recommended first checks:

```text
git fetch origin main
git status --short
git branch --show-current
git log --oneline --decorate -8
gh run view 32460338822 --repo kota200/map_web
```

## What is complete on the W6 branch

The following commits are already pushed:

- `336abbe` — reproducible Web W6 browser gates and GitHub workflow
- `f1b0cf5` — track Web validation sources required in clean CI checkouts
- `d6955f2` — preserve cross-browser gate diagnostics
- `0455b62` — preserve Firefox Worker error messages and apply the Kallisto Web
  patch in clean CI
- `0e5834e` — document cross-browser acceptance and expose measured browser
  support in the product UI
- `435b674` — isolate every browser gate in a fresh browser process

Important delivered behavior:

- `.github/workflows/web-w6.yml` runs dependency-free contracts and the archived
  Kallisto, W5, and W6 browser gates.
- Chromium and Firefox are required jobs. Linux Playwright WebKit is a permitted
  diagnostic failure and must not be described as Apple Safari validation.
- `tools/w6-validation/run-browser-gates.mjs` starts a fresh browser process for
  each gate. Do not collapse this back to one shared process: run
  `32459655376` showed Firefox hanging after fastp OFF when earlier gates shared
  the same browser process. The isolation fix made Firefox finish successfully.
- Firefox Worker errors now preserve `name`, `message`, and `stack`, including
  the human-readable paired-read-count mismatch.
- Browser support is classified by `js/browser-capabilities.mjs`:
  - Chromium: Supported at the measured boundary
  - Firefox: Experimental; only small deterministic fixtures were measured
  - Safari/unknown: Unsupported for this gate
- The Home UI reports the measured browser classification and the correct
  Desktop state: D1/D2 engineering accepted, but signing/release approval is
  pending.
- W6 status, limitations, testing instructions, and evidence are reflected in
  the README and `docs/` files.

## Accepted verification evidence

Latest green workflow:

- Run: <https://github.com/kota200/map_web/actions/runs/32460338822>
- Commit: `435b674b8782a7249037601ee69a08b0ac63cbc1`
- Overall conclusion: success
- `static-contracts`: success
- `browser-gates (chromium, false)`: success
- `browser-gates (firefox, false)`: success
- `browser-gates (webkit, true)`: job failure, but intentionally allowed by
  `continue-on-error`; the overall workflow is successful

The WebKit diagnostic currently reports missing OPFS and an unavailable
packaged Kallisto Memory64 runtime. This is useful negative evidence, not a
regression and not Safari evidence.

The durable report
`tools/w6-validation/reports/cross-browser-ci-2026-08-21.json` records the first
accepted cross-browser run (`32458539850`, commit `0455b62`). The newer run
`32460338822` verifies the final per-gate process-isolation change. If the report
is refreshed, retain the original evidence or explain the replacement; never
rewrite a failed job as passed.

Dependency-free tests passed locally before the final push:

```text
node build/check-static.mjs
node build/test-batch-results.mjs
node build/test-worker-lifecycle.mjs
node build/test-contracts.mjs
node build/test-product-shell.mjs
node tools/w3-storage/tests/static-contract.mjs
node tools/w4-catalog/tests/static-contract.mjs
node tools/w5-pipeline/tests/static-contract.mjs
node tools/w6-validation/tests/static-contract.mjs
```

The W6 static contract verifies five representative files totaling
3,243,870,531 locked bytes. Browser evidence and representative native evidence
must remain clearly separated from small synthetic fixtures.

## Files to read before continuing

- `docs/IMPLEMENTATION_PLAN.md`
- `docs/VALIDATION_REPORT.md`
- `docs/KNOWN_LIMITATIONS.md`
- `docs/TESTING.md`
- `docs/WEB_LARGE_FILE_ARCHITECTURE.md`
- `tools/w6-validation/README.md`
- `tools/w6-validation/reports/cross-browser-ci-2026-08-21.json`
- `.github/workflows/web-w6.yml`
- `tools/w6-validation/run-browser-gates.mjs`
- `js/browser-capabilities.mjs`

Representative native HISAT2/featureCounts evidence is under
`tools/w6-validation/representative-hisat2/`. It contains the pinned native
summary, raw counts, Length, TPM, checksums, and build manifest. The generated
eight-part HISAT2 index is reproducible but is not committed or approved as a
production download.

## Remaining W6 release blockers

Do **not** mark W6 complete until all required acceptance evidence exists:

1. Approve and configure a production HTTPS HISAT2 catalog/CDN with immutable
   artifacts, exact assembly/annotation provenance, SHA-256 values, licenses,
   redistribution analysis, and operational ownership.
2. Run the representative HISAT2 workflow in the browser and compare its
   alignment/count/Length/TPM outputs against the retained native baseline.
3. Measure representative browser memory, OPFS/storage consumption, runtime,
   cancellation cleanup, corruption recovery, eviction/reload behavior, and
   practical support boundaries. The synthetic 4,203,807-byte package is not
   representative-scale evidence.
4. Test real Apple Safari on macOS. Linux Playwright WebKit must not be used as
   a substitute.
5. Resolve any release-policy decision about whether Firefox remains
   Experimental or gains a broader support claim after representative-scale
   measurement.

These blockers require approved hosting/licensing decisions, large-data Web
measurement, or a real macOS Safari environment. Do not invent URLs, hashes,
licenses, or passing measurements to close them.

## Recommended next action

The current branch is ready for review. The immediate repository action is to
create a Draft PR from `phase-w6-release-gate` to `main`, clearly stating that it
adds reproducible W6 infrastructure and measured browser classifications but
does not complete W6.

After review/merge, continue the substantive W6 work only when production
catalog authority and/or the representative browser test environment are
available. Until then, keep the synthetic HISAT2 workflow visibly Experimental
and production hosting unconfigured.

## Safety and licensing constraints

- Endpoint security previously blocked local Rust/Tauri processes, including
  the Rust toolchain executable. Do not run local Rust, Tauri, or bundled
  sidecars unless the user explicitly reauthorizes it and the security-policy
  issue is cleared. Desktop D1/D2 already has accepted clean-CI evidence.
- Do not execute downloaded or unregistered binaries locally.
- Preserve sidecar SHA-256 allowlisting, provenance, corresponding-source, and
  license records. Do not commit third-party binaries unless redistribution is
  explicitly approved and documented.
- Do not claim signed/notarized Desktop release support. Existing cross-platform
  installers are unsigned engineering artifacts.
- Avoid staging `.w6-ci/` diagnostics or the dirty `vendor/kallisto` submodule.

## Truthfulness rules for status reports

- W6: in progress, not complete.
- Chromium: Supported only at the documented measured boundaries.
- Firefox: Experimental; small gates passed, representative scale unmeasured.
- Safari: Unsupported/unmeasured for this gate.
- WebKit job failure: expected diagnostic, permitted by the workflow.
- Desktop D1/D2: engineering acceptance complete; signing, notarization, legal
  approval, and public release approval remain external blockers.
