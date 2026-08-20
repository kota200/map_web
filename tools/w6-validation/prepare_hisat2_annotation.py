#!/usr/bin/env python3
"""Create a deterministic exon-level GTF and TPM table for W6 native HISAT2 evidence.

The supplied TAIR12 annotation is GFF3.  featureCounts needs an explicit
gene-level grouping attribute for the product's count/Length/TPM result
model, so this tool resolves exon -> transcript -> gene and writes only exon
records with GTF ``gene_id`` and ``transcript_id`` attributes.
"""

from __future__ import annotations

import argparse
import gzip
import json
from collections.abc import Iterator
from pathlib import Path


def attributes(field: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in field.strip().split(";"):
        if not item or "=" not in item:
            continue
        key, value = item.split("=", 1)
        result[key] = value.strip().strip('"')
    return result


def gff_rows(path: Path) -> Iterator[list[str]]:
    with gzip.open(path, "rt", encoding="utf-8", newline="") as source:
        for line in source:
            if not line.startswith("#"):
                fields = line.rstrip("\r\n").split("\t")
                if len(fields) == 9:
                    yield fields


def parent_ids(value: str | None) -> list[str]:
    return [item for item in (value or "").split(",") if item]


def build_gtf(source: Path, destination: Path) -> dict[str, object]:
    transcript_to_gene: dict[str, str] = {}
    gene_ids: set[str] = set()
    contigs: set[str] = set()
    for fields in gff_rows(source):
        contigs.add(fields[0])
        attrs = attributes(fields[8])
        if fields[2] == "gene" and attrs.get("ID"):
            gene_ids.add(attrs["ID"])
        # GFF3 allows many transcript feature names (for example
        # ``miRNA_primary_transcript``).  Any non-exon feature with an ID and
        # parent is an eligible exon-parent mapping; the exon records below
        # are still the only records emitted to the GTF.
        identifier = attrs.get("ID")
        parents = parent_ids(attrs.get("Parent"))
        if fields[2] != "exon" and identifier and parents:
            transcript_to_gene[identifier] = parents[0]

    exons = 0
    unresolved = 0
    unresolved_parents: list[str] = []
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8", newline="\n") as target:
        for fields in gff_rows(source):
            if fields[2] != "exon":
                continue
            attrs = attributes(fields[8])
            transcripts = parent_ids(attrs.get("Parent"))
            genes = sorted({transcript_to_gene.get(entry, entry) for entry in transcripts
                            if entry in transcript_to_gene or entry in gene_ids})
            if not genes:
                unresolved += 1
                if len(unresolved_parents) < 10:
                    unresolved_parents.append(attrs.get("Parent", "<missing Parent>"))
                continue
            for gene_id in genes:
                transcript_id = next((entry for entry in transcripts if transcript_to_gene.get(entry) == gene_id), transcripts[0])
                target.write("\t".join([
                    fields[0], fields[1], "exon", fields[3], fields[4], fields[5], fields[6], fields[7],
                    f'gene_id "{gene_id}"; transcript_id "{transcript_id}";',
                ]) + "\n")
                exons += 1
    if exons == 0 or unresolved:
        raise ValueError(
            f"GFF3 conversion failed: exons={exons}, unresolved_exons={unresolved}, "
            f"example_parents={unresolved_parents}."
        )
    return {
        "source": str(source), "output": str(destination), "contigs": sorted(contigs),
        "transcripts": len(transcript_to_gene), "exons": exons, "unresolved_exons": unresolved,
    }


def write_tpm(counts: Path, destination: Path) -> None:
    rows: list[tuple[str, int, float]] = []
    with counts.open("r", encoding="utf-8", newline="") as source:
        for line in source:
            if line.startswith("#") or line.startswith("Geneid\t"):
                continue
            fields = line.rstrip("\r\n").split("\t")
            if len(fields) < 7:
                continue
            length = int(fields[5])
            count = float(fields[6])
            if length <= 0:
                raise ValueError(f"Non-positive feature length for {fields[0]}.")
            rows.append((fields[0], length, count / (length / 1000.0)))
    denominator = sum(value for _, _, value in rows)
    if not rows or denominator <= 0:
        raise ValueError("Cannot calculate TPM from an empty or zero-count native result.")
    with destination.open("w", encoding="utf-8", newline="\n") as target:
        target.write("gene_id\tLength\traw_count\tTPM\n")
        for gene_id, length, rpk in rows:
            target.write(f"{gene_id}\t{length}\t{rpk * length / 1000.0:.6f}\t{rpk / denominator * 1_000_000.0:.6f}\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    subcommands = parser.add_subparsers(dest="command", required=True)
    convert = subcommands.add_parser("gff3-to-gtf")
    convert.add_argument("source", type=Path)
    convert.add_argument("destination", type=Path)
    convert.add_argument("--report", type=Path, required=True)
    tpm = subcommands.add_parser("tpm")
    tpm.add_argument("counts", type=Path)
    tpm.add_argument("destination", type=Path)
    args = parser.parse_args()
    if args.command == "gff3-to-gtf":
        report = build_gtf(args.source, args.destination)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    else:
        write_tpm(args.counts, args.destination)


if __name__ == "__main__":
    main()
