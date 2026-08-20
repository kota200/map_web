#!/usr/bin/env python3
"""Apply the isolated HISAT2 2.2.3 wasm32 portability/build patch.

The only algorithm-adjacent change makes an existing coordinate subtraction
explicitly signed. The Makefile addition creates a deterministic browser-only
target; native targets and the alignment algorithm remain otherwise unchanged.
Every replacement fails closed if the pinned upstream source drifts.
"""

from pathlib import Path
import sys


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: apply-wasm-port.py <hisat2-source-root>")
    root = Path(sys.argv[1]).resolve()

    result_header = root / "aligner_result.h"
    result_text = result_header.read_text(encoding="utf-8")
    result_text = replace_once(
        result_text,
        "        st2.adjustOff(1 - refExtent());",
        "        st2.adjustOff(1 - static_cast<TRefOff>(refExtent()));",
        "signed reference-coordinate offset",
    )
    result_header.write_text(result_text, encoding="utf-8", newline="\n")

    makefile = root / "Makefile"
    make_text = makefile.read_text(encoding="utf-8")
    marker = "\n# kallisto-web W2 deterministic WebAssembly target\n"
    if marker in make_text:
        raise SystemExit("Wasm Makefile target is already present")
    make_text += marker + r'''WASM_PORT_DEFS = -fno-strict-aliasing \
	-DHISAT2_VERSION="\"2.2.3\"" \
	-DBUILD_HOST="\"reproducible\"" \
	-DBUILD_TIME="\"source-date-epoch-1723593600\"" \
	-DCOMPILER_VERSION="\"Emscripten_6.0.6\"" \
	$(FILE_FLAGS)
WASM_RELEASE_DEFS = -DCOMPILER_OPTIONS="\"W2-O3-wasm-simd128-pthreads\""

.PHONY: hisat2-align-s-wasm
hisat2-align-s-wasm: hisat2.cpp $(SEARCH_CPPS) $(SHARED_CPPS) $(HEADERS) $(SEARCH_FRAGMENTS)
	$(CXX) $(RELEASE_FLAGS) $(WASM_RELEASE_DEFS) $(EXTRA_FLAGS) \
	$(WASM_PORT_DEFS) $(SRA_DEF) -DBOWTIE2 $(NOASSERT_FLAGS) -Wall \
	$(INC) $(SEARCH_INC) \
	-o hisat2.mjs $< \
	$(SHARED_CPPS) $(HISAT2_CPPS_MAIN) \
	$(LIBS) $(SRA_LIB) $(SEARCH_LIBS)
'''
    makefile.write_text(make_text, encoding="utf-8", newline="\n")
    print(f"Applied HISAT2 2.2.3 wasm32 portability patch to {root}")


if __name__ == "__main__":
    main()
