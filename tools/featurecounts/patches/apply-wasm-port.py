#!/usr/bin/env python3
"""Apply isolated browser portability changes to Subread/featureCounts 2.1.1.

The counting algorithm is unchanged. The patch maps fopen64 to the standard
large-file-capable Emscripten stdio implementation, skips host file-descriptor
limit probes that are not meaningful in a browser, removes terminal color
codes from captured logs, and gives the generated module an ES-module suffix.
All replacements fail closed if the pinned source drifts.
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
        raise SystemExit("usage: apply-wasm-port.py <subread-source-root>")
    root = Path(sys.argv[1]).resolve()

    input_files = root / "src" / "input-files.c"
    text = input_files.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "#if defined(__LP64__) || defined(_LP64) || defined(MACOS) ",
        "#if defined(__EMSCRIPTEN__) || defined(__LP64__) || defined(_LP64) || defined(MACOS) ",
        "Emscripten fopen",
    )
    text = replace_once(
        text,
        """int SAM_pairer_warning_file_open_limit(){
#ifndef __MINGW32__""",
        """int SAM_pairer_warning_file_open_limit(){
#if !defined(__MINGW32__) && !defined(__EMSCRIPTEN__)""",
        "SAM file-limit probe",
    )
    input_files.write_text(text, encoding="utf-8", newline="\n")

    core = root / "src" / "core.c"
    text = core.read_text(encoding="utf-8")
    text = replace_once(
        text,
        """void warning_file_limit()
{
	#ifndef __MINGW32__""",
        """void warning_file_limit()
{
	#if !defined(__MINGW32__) && !defined(__EMSCRIPTEN__)""",
        "generic file-limit probe",
    )
    core.write_text(text, encoding="utf-8", newline="\n")

    sublog = root / "src" / "sublog.c"
    text = sublog.read_text(encoding="utf-8")
    text = replace_once(
        text,
        """#if defined(MAKE_STANDALONE) || defined(RUNNING_ENV)
	return !isatty(fileno(stderr));""",
        """#if defined(__EMSCRIPTEN__)
	return 1;
	#elif defined(MAKE_STANDALONE) || defined(RUNNING_ENV)
	return !isatty(fileno(stderr));""",
        "captured log color",
    )
    sublog.write_text(text, encoding="utf-8", newline="\n")

    makefile = root / "src" / "Makefile.Linux"
    text = makefile.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "\t${CC} -o featureCounts readSummary.c ${ALL_OBJECTS} ${LDFLAGS}",
        "\t${CC} -o featureCounts.mjs readSummary.c ${ALL_OBJECTS} ${LDFLAGS}",
        "ES module output",
    )
    makefile.write_text(text, encoding="utf-8", newline="\n")
    print(f"Applied featureCounts 2.1.1 browser portability patch to {root}")


if __name__ == "__main__":
    main()
