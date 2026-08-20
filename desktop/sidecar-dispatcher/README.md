# HISAT2 Windows dispatcher

This tiny MIT-licensed Windows launcher selects the unmodified HISAT2 native
small (`*.ht2`) or large (`*.ht2l`) helper beside it. It exists because the
upstream `hisat2` and `hisat2-build` launchers are scripts; end users must not
need Python or Perl. The CI workflow compiles it twice, once with
`HISAT2_BUILD_DISPATCHER`, and the Rust sidecar manifest hashes both launchers
and their four helper executables before launch.

For index creation, `--large-index` selects the large helper; otherwise the
launcher scans local uncompressed FASTA input and changes to the large helper
after 3.9 Gbp. This avoids putting FASTA content in the WebView. The desktop
preflight must still warn about the large memory and disk requirement.
