use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;
pub mod index;
pub mod kallisto;
pub mod results;
pub mod sidecars;
pub mod temporary;

#[derive(Debug, Error)]
pub enum DesktopError {
    #[error("unsupported tool: {0}")]
    UnsupportedTool(String),
    #[error("path must be absolute and must not contain traversal: {0}")]
    UnsafePath(String),
    #[error("sample must provide exactly one mode of reads")]
    InvalidReads,
    #[error("native process error: {0}")]
    Process(String),
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum Tool {
    Fastp,
    Hisat2,
    Hisat2Build,
    FeatureCounts,
    Kallisto,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NativeSample {
    pub name: String,
    pub r1: PathBuf,
    pub r2: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Hisat2Request {
    pub sample: NativeSample,
    pub index_prefix: PathBuf,
    pub annotation: PathBuf,
    pub output_dir: PathBuf,
    pub threads: u8,
    pub run_fastp: bool,
    pub strandedness: u8,
    pub feature_type: String,
    pub grouping_attribute: String,
    pub keep_sam: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct PlannedCommand {
    pub tool: Tool,
    pub args: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RunPlan {
    pub run_id: Uuid,
    pub temporary_dir: PathBuf,
    pub final_output_dir: PathBuf,
    pub sam_path: PathBuf,
    pub counts_path: PathBuf,
    pub raw_counts_path: PathBuf,
    pub counts_with_tpm_path: PathBuf,
    pub final_counts_path: PathBuf,
    pub final_raw_counts_path: PathBuf,
    pub final_counts_with_tpm_path: PathBuf,
    pub final_summary_path: PathBuf,
    pub keep_sam: bool,
    pub commands: Vec<PlannedCommand>,
}

pub(crate) fn checked(path: &Path) -> Result<(), DesktopError> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(DesktopError::UnsafePath(path.display().to_string()));
    }
    Ok(())
}

pub fn plan_hisat2(request: &Hisat2Request) -> Result<RunPlan, DesktopError> {
    for path in [
        &request.sample.r1,
        &request.index_prefix,
        &request.annotation,
        &request.output_dir,
    ] {
        checked(path)?;
    }
    if let Some(r2) = &request.sample.r2 {
        checked(r2)?;
    }
    if request.threads == 0
        || request.threads > 64
        || request.strandedness > 2
        || request.feature_type.is_empty()
        || request.grouping_attribute.is_empty()
    {
        return Err(DesktopError::InvalidReads);
    }
    let run_id = Uuid::new_v4();
    let temporary_dir = request
        .output_dir
        .join(".rna-seq-tmp")
        .join(run_id.to_string());
    let sam_path = temporary_dir.join("alignment.sam");
    let counts_path = temporary_dir.join("featureCounts.txt");
    let raw_counts_path = temporary_dir.join("counts.tsv");
    let counts_with_tpm_path = temporary_dir.join("counts_with_tpm.tsv");
    let final_output_dir = request.output_dir.join(run_id.to_string());
    let final_counts_path = final_output_dir.join("featureCounts.txt");
    let mut commands = Vec::new();
    let input1 = request.sample.r1.display().to_string();
    let input2 = request.sample.r2.as_ref().map(|p| p.display().to_string());
    let (hisat_r1, hisat_r2) = if request.run_fastp {
        let cleaned_r1 = temporary_dir.join("cleaned-R1.fastq.gz");
        let cleaned_r2 = request
            .sample
            .r2
            .as_ref()
            .map(|_| temporary_dir.join("cleaned-R2.fastq.gz"));
        let mut fastp = vec![
            "-i".into(),
            input1,
            "-o".into(),
            cleaned_r1.display().to_string(),
        ];
        if let (Some(r2), Some(clean_r2)) = (input2, &cleaned_r2) {
            fastp.extend(["-I".into(), r2, "-O".into(), clean_r2.display().to_string()]);
        }
        commands.push(PlannedCommand {
            tool: Tool::Fastp,
            args: fastp,
        });
        (
            cleaned_r1.display().to_string(),
            cleaned_r2.map(|p| p.display().to_string()),
        )
    } else {
        (input1, input2)
    };
    let mut hisat = vec![
        "--dta".into(),
        "-p".into(),
        request.threads.to_string(),
        "-x".into(),
        request.index_prefix.display().to_string(),
        "-1".into(),
        hisat_r1,
        "-S".into(),
        sam_path.display().to_string(),
    ];
    if let Some(r2) = hisat_r2 {
        hisat.extend(["-2".into(), r2]);
    } else {
        let mate_flag = hisat.iter().position(|x| x == "-1").unwrap();
        hisat[mate_flag] = "-U".into();
    }
    commands.push(PlannedCommand {
        tool: Tool::Hisat2,
        args: hisat,
    });
    commands.push(PlannedCommand {
        tool: Tool::FeatureCounts,
        args: vec![
            "-T".into(),
            request.threads.to_string(),
            "-s".into(),
            request.strandedness.to_string(),
            "-t".into(),
            request.feature_type.clone(),
            "-g".into(),
            request.grouping_attribute.clone(),
            "-a".into(),
            request.annotation.display().to_string(),
            "-o".into(),
            counts_path.display().to_string(),
            sam_path.display().to_string(),
        ],
    });
    Ok(RunPlan {
        run_id,
        temporary_dir,
        final_output_dir: final_output_dir.clone(),
        sam_path,
        counts_path,
        raw_counts_path,
        counts_with_tpm_path,
        final_counts_path,
        final_raw_counts_path: final_output_dir.join("counts.tsv"),
        final_counts_with_tpm_path: final_output_dir.join("counts_with_tpm.tsv"),
        final_summary_path: final_output_dir.join("featureCounts.txt.summary"),
        keep_sam: request.keep_sam,
        commands,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> Hisat2Request {
        let root = std::env::temp_dir().join("rna-seq-desktop-plan-test");
        Hisat2Request {
            sample: NativeSample {
                name: "日本語 sample".into(),
                r1: root.join("data/R1.fq.gz"),
                r2: Some(root.join("data/R2.fq.gz")),
            },
            index_prefix: root.join("refs/arabidopsis"),
            annotation: root.join("refs/annotation.gtf"),
            output_dir: root.join("runs/結果"),
            threads: 4,
            run_fastp: false,
            strandedness: 0,
            feature_type: "exon".into(),
            grouping_attribute: "gene_id".into(),
            keep_sam: false,
        }
    }
    #[test]
    fn creates_typed_native_commands() {
        let plan = plan_hisat2(&request()).unwrap();
        assert_eq!(plan.commands.len(), 2);
        assert!(plan.commands[0].args.contains(&"--dta".into()));
        assert!(plan.sam_path.to_string_lossy().contains("alignment.sam"));
    }
    #[test]
    fn rejects_traversal() {
        let mut r = request();
        r.annotation = std::env::temp_dir().join("refs/../bad.gtf");
        assert!(matches!(plan_hisat2(&r), Err(DesktopError::UnsafePath(_))));
    }
    #[test]
    fn fastp_output_is_used_by_hisat2() {
        let mut r = request();
        r.run_fastp = true;
        let plan = plan_hisat2(&r).unwrap();
        assert!(plan.commands[1]
            .args
            .iter()
            .any(|x| x.ends_with("-R1.fastq.gz")));
        assert!(plan.commands[0].args.iter().any(|x| x == "-I"));
    }
}
