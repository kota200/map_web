use crate::{checked, DesktopError, NativeSample, PlannedCommand, Tool};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct KallistoRequest {
    pub sample: NativeSample,
    pub index: PathBuf,
    pub output_dir: PathBuf,
    pub threads: u8,
    pub run_fastp: bool,
    pub fragment_length: Option<f64>,
    pub fragment_length_sd: Option<f64>,
    #[serde(default)]
    pub bootstrap_samples: u16,
    #[serde(default)]
    pub bias: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct KallistoRunPlan {
    pub run_id: Uuid,
    pub temporary_dir: PathBuf,
    pub final_output_dir: PathBuf,
    pub abundance_path: PathBuf,
    pub run_info_path: PathBuf,
    pub desktop_manifest_path: PathBuf,
    pub sample: NativeSample,
    pub index: PathBuf,
    pub threads: u8,
    pub commands: Vec<PlannedCommand>,
}

#[derive(Clone, Debug, Serialize)]
pub struct KallistoStageRecord {
    pub tool: Tool,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    pub elapsed_milliseconds: i64,
    pub exit_code: i32,
}

pub fn plan_kallisto(request: &KallistoRequest) -> Result<KallistoRunPlan, DesktopError> {
    for path in [&request.sample.r1, &request.index, &request.output_dir] {
        checked(path)?;
    }
    if let Some(r2) = &request.sample.r2 {
        checked(r2)?;
    }
    if request.sample.name.trim().is_empty()
        || request.sample.name.chars().any(char::is_control)
        || request.threads == 0
        || request.threads > 64
        || request.bootstrap_samples > 1_000
    {
        return Err(DesktopError::InvalidReads);
    }

    let single_end = request.sample.r2.is_none();
    match (
        single_end,
        request.fragment_length,
        request.fragment_length_sd,
    ) {
        (true, Some(length), Some(sd))
            if length.is_finite() && length > 0.0 && sd.is_finite() && sd > 0.0 => {}
        (true, _, _) => return Err(DesktopError::InvalidReads),
        (false, None, None) => {}
        (false, _, _) => return Err(DesktopError::InvalidReads),
    }

    let run_id = Uuid::new_v4();
    let temporary_dir = request
        .output_dir
        .join(".rna-seq-tmp")
        .join(run_id.to_string());
    let final_output_dir = request.output_dir.join(run_id.to_string());
    let mut commands = Vec::new();
    let input1 = request.sample.r1.display().to_string();
    let input2 = request
        .sample
        .r2
        .as_ref()
        .map(|path| path.display().to_string());
    let (quant_r1, quant_r2) = if request.run_fastp {
        let cleaned_r1 = temporary_dir.join("cleaned-R1.fastq.gz");
        let cleaned_r2 = request
            .sample
            .r2
            .as_ref()
            .map(|_| temporary_dir.join("cleaned-R2.fastq.gz"));
        let mut args = vec![
            "-i".into(),
            input1,
            "-o".into(),
            cleaned_r1.display().to_string(),
            "--json".into(),
            temporary_dir.join("fastp.json").display().to_string(),
            "--html".into(),
            temporary_dir.join("fastp.html").display().to_string(),
        ];
        if let (Some(r2), Some(output_r2)) = (input2, &cleaned_r2) {
            args.extend([
                "-I".into(),
                r2,
                "-O".into(),
                output_r2.display().to_string(),
            ]);
        }
        commands.push(PlannedCommand {
            tool: Tool::Fastp,
            args,
        });
        (
            cleaned_r1.display().to_string(),
            cleaned_r2.map(|path| path.display().to_string()),
        )
    } else {
        (input1, input2)
    };

    let mut quant = vec![
        "quant".into(),
        "-i".into(),
        request.index.display().to_string(),
        "-o".into(),
        temporary_dir.display().to_string(),
        "-t".into(),
        request.threads.to_string(),
        "--plaintext".into(),
    ];
    if request.bootstrap_samples > 0 {
        quant.extend(["-b".into(), request.bootstrap_samples.to_string()]);
    }
    if request.bias {
        quant.push("--bias".into());
    }
    if single_end {
        quant.extend([
            "--single".into(),
            "-l".into(),
            request.fragment_length.unwrap().to_string(),
            "-s".into(),
            request.fragment_length_sd.unwrap().to_string(),
        ]);
    }
    quant.push(quant_r1);
    if let Some(r2) = quant_r2 {
        quant.push(r2);
    }
    commands.push(PlannedCommand {
        tool: Tool::Kallisto,
        args: quant,
    });

    Ok(KallistoRunPlan {
        run_id,
        abundance_path: temporary_dir.join("abundance.tsv"),
        run_info_path: temporary_dir.join("run_info.json"),
        desktop_manifest_path: temporary_dir.join("desktop-run-manifest.json"),
        temporary_dir,
        final_output_dir,
        sample: request.sample.clone(),
        index: request.index.clone(),
        threads: request.threads,
        commands,
    })
}

pub fn finalize_kallisto_run(
    plan: &KallistoRunPlan,
    kallisto_version: &str,
    stages: &[KallistoStageRecord],
) -> Result<(), DesktopError> {
    if plan.final_output_dir.exists() {
        return Err(DesktopError::Process(
            "refusing to overwrite an existing result directory".into(),
        ));
    }
    validate_abundance(&plan.abundance_path)?;
    let run_info_text = fs::read_to_string(&plan.run_info_path).map_err(|error| {
        DesktopError::Process(format!("kallisto run_info.json is missing: {error}"))
    })?;
    let run_info: Value = serde_json::from_str(&run_info_text).map_err(|error| {
        DesktopError::Process(format!("kallisto run_info.json is invalid: {error}"))
    })?;
    let n_processed = run_info
        .get("n_processed")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            DesktopError::Process("kallisto run_info.json has no valid n_processed value".into())
        })?;
    let n_pseudoaligned = run_info
        .get("n_pseudoaligned")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            DesktopError::Process(
                "kallisto run_info.json has no valid n_pseudoaligned value".into(),
            )
        })?;
    if n_pseudoaligned > n_processed {
        return Err(DesktopError::Process(
            "kallisto run_info.json reports more pseudoaligned than processed reads".into(),
        ));
    }
    if !run_info
        .get("kallisto_version")
        .and_then(Value::as_str)
        .is_some_and(|version| version.contains(kallisto_version))
    {
        return Err(DesktopError::Process(format!(
            "kallisto run_info.json does not report registered version {kallisto_version}"
        )));
    }

    for name in ["cleaned-R1.fastq.gz", "cleaned-R2.fastq.gz"] {
        let path = plan.temporary_dir.join(name);
        if path.exists() {
            fs::remove_file(path).map_err(|error| {
                DesktopError::Process(format!("could not remove temporary cleaned FASTQ: {error}"))
            })?;
        }
    }

    let mut outputs = vec![
        output_record(&plan.abundance_path, "transcript_abundance")?,
        output_record(&plan.run_info_path, "kallisto_run_info")?,
    ];
    for (name, role) in [
        ("fastp.json", "fastp_machine_report"),
        ("fastp.html", "fastp_human_report"),
    ] {
        let path = plan.temporary_dir.join(name);
        if path.exists() {
            outputs.push(output_record(&path, role)?);
        }
    }
    let mut bootstrap_paths = fs::read_dir(&plan.temporary_dir)
        .map_err(|error| {
            DesktopError::Process(format!("could not inspect kallisto outputs: {error}"))
        })?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("bs_abundance_") && name.ends_with(".tsv"))
        })
        .collect::<Vec<_>>();
    bootstrap_paths.sort();
    for path in bootstrap_paths {
        validate_abundance(&path)?;
        outputs.push(output_record(&path, "bootstrap_transcript_abundance")?);
    }
    let quant_arguments = plan
        .commands
        .iter()
        .find(|command| command.tool == Tool::Kallisto)
        .map(|command| redact_arguments(&command.args, plan))
        .unwrap_or_default();
    let mut input_records = vec![input_record(&plan.sample.r1)?];
    if let Some(path) = &plan.sample.r2 {
        input_records.push(input_record(path)?);
    }
    let manifest = json!({
        "schema_version": 1,
        "run_id": plan.run_id,
        "app_version": env!("CARGO_PKG_VERSION"),
        "mode": "desktop",
        "engine": "kallisto",
        "platform": { "os": std::env::consts::OS, "architecture": std::env::consts::ARCH },
        "tool_versions": { "kallisto": kallisto_version },
        "sample": {
            "name": plan.sample.name,
            "layout": if plan.sample.r2.is_some() { "paired-end" } else { "single-end" },
            "inputs": input_records
        },
        "reference": {
            "kind": "local-kallisto-index",
            "basename": basename(&plan.index),
            "size_bytes": file_size(&plan.index)?
        },
        "threads": plan.threads,
        "metrics": {
            "n_processed": n_processed,
            "n_pseudoaligned": n_pseudoaligned,
            "pseudoaligned_percent": if n_processed == 0 {
                0.0
            } else {
                (n_pseudoaligned as f64 * 100.0) / n_processed as f64
            }
        },
        "arguments": quant_arguments,
        "absolute_paths_stored": false,
        "stages": stages,
        "memory_metrics": "unavailable",
        "storage_metrics": "unavailable",
        "outputs": outputs,
        "warnings": [],
        "cleanup": { "temporary_fastq_removed": true, "result_publish": "atomic_rename" }
    });
    fs::write(
        &plan.desktop_manifest_path,
        serde_json::to_vec_pretty(&manifest).map_err(|error| {
            DesktopError::Process(format!("could not serialize run manifest: {error}"))
        })?,
    )
    .map_err(|error| DesktopError::Process(format!("could not write run manifest: {error}")))?;
    fs::rename(&plan.temporary_dir, &plan.final_output_dir).map_err(|error| {
        DesktopError::Process(format!(
            "could not atomically publish kallisto results: {error}"
        ))
    })?;
    Ok(())
}

fn validate_abundance(path: &Path) -> Result<(), DesktopError> {
    let text = fs::read_to_string(path).map_err(|error| {
        DesktopError::Process(format!("kallisto abundance.tsv is missing: {error}"))
    })?;
    let mut lines = text.lines();
    if lines.next() != Some("target_id\tlength\teff_length\test_counts\ttpm") {
        return Err(DesktopError::Process(
            "kallisto abundance.tsv has an unexpected header".into(),
        ));
    }
    let mut targets = HashSet::new();
    let mut rows = 0usize;
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() != 5 || fields[0].is_empty() || !targets.insert(fields[0].to_owned()) {
            return Err(DesktopError::Process(
                "kallisto abundance.tsv contains an invalid or duplicate target".into(),
            ));
        }
        for value in &fields[1..] {
            let number = value.parse::<f64>().map_err(|_| {
                DesktopError::Process("kallisto abundance.tsv contains a non-numeric value".into())
            })?;
            if !number.is_finite() || number < 0.0 {
                return Err(DesktopError::Process(
                    "kallisto abundance.tsv contains an invalid numeric value".into(),
                ));
            }
        }
        rows += 1;
    }
    if rows == 0 {
        return Err(DesktopError::Process(
            "kallisto abundance.tsv contains no targets".into(),
        ));
    }
    Ok(())
}

fn input_record(path: &Path) -> Result<Value, DesktopError> {
    Ok(json!({ "basename": basename(path), "size_bytes": file_size(path)? }))
}

fn output_record(path: &Path, role: &str) -> Result<Value, DesktopError> {
    Ok(json!({ "name": basename(path), "role": role, "size_bytes": file_size(path)? }))
}

fn file_size(path: &Path) -> Result<u64, DesktopError> {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .map_err(|error| {
            DesktopError::Process(format!("could not inspect {}: {error}", basename(path)))
        })
}

fn basename(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unavailable")
        .to_owned()
}

fn redact_arguments(args: &[String], plan: &KallistoRunPlan) -> Vec<String> {
    args.iter()
        .map(|argument| {
            let path = Path::new(argument);
            if path == plan.temporary_dir.as_path() {
                "$OUTPUT".into()
            } else if path.is_absolute() {
                basename(path)
            } else {
                argument.clone()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(paired: bool) -> KallistoRequest {
        let root = std::env::temp_dir().join("rna-seq-kallisto-plan-test");
        KallistoRequest {
            sample: NativeSample {
                name: "sample 1".into(),
                r1: root.join("data/reads 1.fq.gz"),
                r2: paired.then(|| root.join("data/reads 2.fq.gz")),
            },
            index: root.join("refs/transcripts.idx"),
            output_dir: root.join("runs/結果"),
            threads: 4,
            run_fastp: false,
            fragment_length: (!paired).then_some(200.0),
            fragment_length_sd: (!paired).then_some(20.0),
            bootstrap_samples: 0,
            bias: false,
        }
    }

    #[test]
    fn plans_paired_end_quant_without_alignment_arguments() {
        let plan = plan_kallisto(&request(true)).unwrap();
        let quant = plan.commands.last().unwrap();
        assert_eq!(quant.tool, Tool::Kallisto);
        assert_eq!(quant.args[0], "quant");
        assert!(!quant.args.contains(&"--single".into()));
        assert!(!quant.args.iter().any(|argument| argument == "--dta"));
        assert!(quant
            .args
            .iter()
            .any(|argument| argument.ends_with("reads 2.fq.gz")));
    }

    #[test]
    fn single_end_requires_fragment_distribution() {
        let mut invalid = request(false);
        invalid.fragment_length_sd = None;
        assert!(matches!(
            plan_kallisto(&invalid),
            Err(DesktopError::InvalidReads)
        ));
        let plan = plan_kallisto(&request(false)).unwrap();
        assert!(plan
            .commands
            .last()
            .unwrap()
            .args
            .contains(&"--single".into()));
    }

    #[test]
    fn fastp_output_is_used_by_kallisto() {
        let mut input = request(true);
        input.run_fastp = true;
        let plan = plan_kallisto(&input).unwrap();
        assert_eq!(plan.commands.len(), 2);
        assert_eq!(plan.commands[0].tool, Tool::Fastp);
        assert!(plan.commands[1]
            .args
            .iter()
            .any(|argument| argument.ends_with("cleaned-R2.fastq.gz")));
        assert!(plan.commands[0]
            .args
            .iter()
            .any(|argument| argument.ends_with("fastp.json")));
        assert!(plan.commands[0]
            .args
            .iter()
            .any(|argument| argument.ends_with("fastp.html")));
    }
}
