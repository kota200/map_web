#!/usr/bin/env python3
"""Stream-profile the user-provided W6 FASTA/paired FASTQ without writing derivatives."""

from __future__ import annotations

import argparse
import gzip
import json
import time
from pathlib import Path


def fasta_profile(path: Path) -> dict:
    records = 0
    bases = 0
    minimum = None
    maximum = 0
    current = 0
    with path.open("rt", encoding="ascii", errors="strict", newline=None) as handle:
        for line in handle:
            if line.startswith(">"):
                if records:
                    minimum = current if minimum is None else min(minimum, current)
                    maximum = max(maximum, current)
                records += 1
                current = 0
            else:
                sequence = line.strip()
                current += len(sequence)
                bases += len(sequence)
    if records:
        minimum = current if minimum is None else min(minimum, current)
        maximum = max(maximum, current)
    return {"records": records, "bases": bases, "min_length": minimum, "max_length": maximum}


def normalized_id(header: str) -> str:
    return header.removeprefix("@").split()[0].removesuffix("/1").removesuffix("/2")


def paired_fastq_profile(r1_path: Path, r2_path: Path, limit: int | None) -> dict:
    pairs = 0
    bases = 0
    q20 = 0
    q30 = 0
    minimum = None
    maximum = 0
    started = time.perf_counter()
    with gzip.open(r1_path, "rt", encoding="ascii", errors="strict", newline=None) as r1, gzip.open(r2_path, "rt", encoding="ascii", errors="strict", newline=None) as r2:
        while limit is None or pairs < limit:
            left = [r1.readline() for _ in range(4)]
            right = [r2.readline() for _ in range(4)]
            if not left[0] and not right[0]:
                break
            if not all(left) or not all(right):
                raise ValueError(f"Incomplete paired FASTQ record at pair {pairs + 1}")
            for label, record in (("R1", left), ("R2", right)):
                header, sequence, plus, quality = (value.rstrip("\r\n") for value in record)
                if not header.startswith("@") or not plus.startswith("+") or len(sequence) != len(quality):
                    raise ValueError(f"Malformed {label} FASTQ record at pair {pairs + 1}")
                length = len(sequence)
                minimum = length if minimum is None else min(minimum, length)
                maximum = max(maximum, length)
                bases += length
                scores = (ord(character) - 33 for character in quality)
                for score in scores:
                    q20 += score >= 20
                    q30 += score >= 30
            if normalized_id(left[0]) != normalized_id(right[0]):
                raise ValueError(f"R1/R2 read-name mismatch at pair {pairs + 1}")
            pairs += 1
    elapsed = time.perf_counter() - started
    return {
        "pairs": pairs,
        "reads": pairs * 2,
        "bases": bases,
        "min_read_length": minimum,
        "max_read_length": maximum,
        "q20_rate": q20 / bases if bases else None,
        "q30_rate": q30 / bases if bases else None,
        "elapsed_seconds": elapsed,
        "pairs_per_second": pairs / elapsed if elapsed else None,
        "complete_scan": limit is None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--limit-pairs", type=int, default=10000, help="Use 0 for a complete scan")
    args = parser.parse_args()
    root = args.data_dir.resolve()
    started = time.perf_counter()
    result = {
        "schema_version": 1,
        "data_dir": str(root),
        "fasta": fasta_profile(root / "TAIR12_cdna.fasta"),
        "fastq": paired_fastq_profile(
            root / "Unknown_CO100-001U0001_good_1.fq.gz",
            root / "Unknown_CO100-001U0001_good_2.fq.gz",
            None if args.limit_pairs == 0 else args.limit_pairs,
        ),
    }
    result["total_elapsed_seconds"] = time.perf_counter() - started
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
