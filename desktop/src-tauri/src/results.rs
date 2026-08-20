use crate::DesktopError;
use std::{fs, path::Path};

#[derive(Clone, Debug, PartialEq)]
pub struct CountRow {
    pub gene_id: String,
    pub length: f64,
    pub count: f64,
    pub tpm: f64,
}

pub fn write_featurecounts_results(
    feature_counts: &Path,
    raw_counts: &Path,
    counts_with_tpm: &Path,
) -> Result<(), DesktopError> {
    let input = fs::read_to_string(feature_counts).map_err(|error| {
        DesktopError::Process(format!("could not read featureCounts output: {error}"))
    })?;
    let rows = parse_featurecounts(&input)?;
    let raw = rows
        .iter()
        .map(|row| {
            format!(
                "{}\t{}\t{}",
                row.gene_id,
                number(row.length),
                number(row.count)
            )
        })
        .collect::<Vec<_>>();
    let tpm = rows
        .iter()
        .map(|row| {
            format!(
                "{}\t{}\t{}\t{}",
                row.gene_id,
                number(row.length),
                number(row.count),
                number(row.tpm)
            )
        })
        .collect::<Vec<_>>();
    fs::write(
        raw_counts,
        format!("Geneid\tLength\tCount\n{}\n", raw.join("\n")),
    )
    .map_err(|error| DesktopError::Process(format!("could not write counts.tsv: {error}")))?;
    fs::write(
        counts_with_tpm,
        format!("Geneid\tLength\tCount\tTPM\n{}\n", tpm.join("\n")),
    )
    .map_err(|error| DesktopError::Process(format!("could not write counts_with_tpm.tsv: {error}")))
}

pub fn parse_featurecounts(input: &str) -> Result<Vec<CountRow>, DesktopError> {
    let mut rows = Vec::new();
    for line in input.lines().filter(|line| !line.starts_with('#')) {
        let fields: Vec<_> = line.split('\t').collect();
        if fields.first() == Some(&"Geneid") {
            if fields.len() < 7 {
                return Err(DesktopError::Process(
                    "featureCounts header has no sample column".into(),
                ));
            }
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }
        if fields.len() < 7 {
            return Err(DesktopError::Process(
                "malformed featureCounts data row".into(),
            ));
        }
        let length = fields[5]
            .parse::<f64>()
            .map_err(|_| DesktopError::Process("featureCounts Length is invalid".into()))?;
        let count = fields[6]
            .parse::<f64>()
            .map_err(|_| DesktopError::Process("featureCounts count is invalid".into()))?;
        if fields[0].is_empty()
            || !length.is_finite()
            || length <= 0.0
            || !count.is_finite()
            || count < 0.0
        {
            return Err(DesktopError::Process(
                "featureCounts contains an invalid gene, Length, or count".into(),
            ));
        }
        rows.push(CountRow {
            gene_id: fields[0].into(),
            length,
            count,
            tpm: 0.0,
        });
    }
    if rows.is_empty() {
        return Err(DesktopError::Process(
            "featureCounts produced no assignable feature rows".into(),
        ));
    }
    let denominator: f64 = rows.iter().map(|row| row.count / row.length).sum();
    if !denominator.is_finite() || denominator <= 0.0 {
        return Err(DesktopError::Process(
            "cannot calculate TPM: all featureCounts rates are zero".into(),
        ));
    }
    for row in &mut rows {
        row.tpm = (row.count / row.length) / denominator * 1_000_000.0;
    }
    Ok(rows)
}

fn number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_feature_order_and_calculates_tpm() {
        let rows = parse_featurecounts("# Program:featureCounts\nGeneid\tChr\tStart\tEnd\tStrand\tLength\tsample.sam\ng2\tchr1\t1\t20\t+\t200\t10\ng1\tchr1\t21\t120\t+\t100\t10\n").unwrap();
        assert_eq!(
            rows.iter().map(|row| &row.gene_id).collect::<Vec<_>>(),
            vec!["g2", "g1"]
        );
        assert!((rows[0].tpm - 333_333.333_333_333_3).abs() < 1e-8);
        assert!((rows[1].tpm - 666_666.666_666_666_6).abs() < 1e-8);
    }

    #[test]
    fn rejects_zero_tpm_denominator() {
        assert!(parse_featurecounts(
            "Geneid\tChr\tStart\tEnd\tStrand\tLength\tsample.sam\ng1\tchr1\t1\t20\t+\t20\t0\n"
        )
        .is_err());
    }
}
