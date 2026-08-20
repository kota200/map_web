use crate::{checked, DesktopError, PlannedCommand, Tool};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ExistingIndexRequest {
    pub prefix: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct IndexBuildRequest {
    pub fasta: PathBuf,
    pub cache_dir: PathBuf,
    pub index_name: String,
    pub threads: u8,
}

#[derive(Clone, Debug, Serialize)]
pub struct IndexInspection {
    pub prefix: PathBuf,
    pub format: Option<String>,
    pub files: Vec<PathBuf>,
    pub total_bytes: u64,
    pub valid: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct IndexBuildPlan {
    pub build_id: Uuid,
    pub temporary_dir: PathBuf,
    pub temporary_prefix: PathBuf,
    pub final_directory: PathBuf,
    pub final_prefix: PathBuf,
    pub command: PlannedCommand,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IndexFileManifest {
    pub name: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IndexManifest {
    pub schema_version: u8,
    pub index_id: String,
    pub fasta: FastaManifest,
    pub hisat2_version: String,
    pub build_arguments: Vec<String>,
    pub index_format: String,
    pub files: Vec<IndexFileManifest>,
    pub started_at: String,
    pub completed_at: String,
    pub validation: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FastaManifest {
    pub basename: String,
    pub bytes: u64,
    pub sha256: String,
}

pub fn inspect_existing_index(
    request: &ExistingIndexRequest,
) -> Result<IndexInspection, DesktopError> {
    checked(&request.prefix)?;
    for extension in ["ht2", "ht2l"] {
        let files = index_files(&request.prefix, extension);
        if files.iter().all(|file| file.is_file()) {
            let total_bytes = files
                .iter()
                .filter_map(|file| fs::metadata(file).ok())
                .map(|metadata| metadata.len())
                .sum();
            return Ok(IndexInspection {
                prefix: request.prefix.clone(),
                format: Some(extension.into()),
                files,
                total_bytes,
                valid: true,
                detail: "all eight HISAT2 index files are present".into(),
            });
        }
    }
    Ok(IndexInspection {
        prefix: request.prefix.clone(),
        format: None,
        files: Vec::new(),
        total_bytes: 0,
        valid: false,
        detail: "expected all .1-.8.ht2 or .ht2l files at this prefix".into(),
    })
}

pub fn plan_hisat2_index_build(
    request: &IndexBuildRequest,
) -> Result<IndexBuildPlan, DesktopError> {
    checked(&request.fasta)?;
    checked(&request.cache_dir)?;
    if request.threads == 0
        || request.threads > 64
        || request.index_name.is_empty()
        || request.index_name.contains(['/', '\\'])
        || request.index_name == "."
        || request.index_name == ".."
    {
        return Err(DesktopError::InvalidReads);
    }
    let build_id = Uuid::new_v4();
    let temporary_dir = request
        .cache_dir
        .join(".rna-seq-index-tmp")
        .join(build_id.to_string());
    let temporary_prefix = temporary_dir.join("index");
    let final_directory = request.cache_dir.join(&request.index_name);
    let final_prefix = final_directory.join("index");
    Ok(IndexBuildPlan {
        build_id,
        temporary_dir,
        temporary_prefix: temporary_prefix.clone(),
        final_directory,
        final_prefix,
        command: PlannedCommand {
            tool: Tool::Hisat2Build,
            args: vec![
                "--threads".into(),
                request.threads.to_string(),
                request.fasta.display().to_string(),
                temporary_prefix.display().to_string(),
            ],
        },
    })
}

pub fn finalize_index_build(
    plan: &IndexBuildPlan,
    fasta: &Path,
    hisat2_version: &str,
    started_at: String,
) -> Result<IndexManifest, DesktopError> {
    if plan.final_directory.exists() {
        return Err(DesktopError::Process(
            "refusing to overwrite an existing index directory".into(),
        ));
    }
    let inspection = inspect_existing_index(&ExistingIndexRequest {
        prefix: plan.temporary_prefix.clone(),
    })?;
    if !inspection.valid {
        return Err(DesktopError::Process(format!(
            "hisat2-build output validation failed: {}",
            inspection.detail
        )));
    }
    let files = inspection
        .files
        .iter()
        .map(file_manifest)
        .collect::<Result<Vec<_>, _>>()?;
    let manifest = IndexManifest {
        schema_version: 1,
        index_id: plan.build_id.to_string(),
        fasta: FastaManifest {
            basename: fasta
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("fasta")
                .into(),
            bytes: fs::metadata(fasta)
                .map_err(|error| {
                    DesktopError::Process(format!("could not inspect FASTA: {error}"))
                })?
                .len(),
            sha256: sha256_file(fasta)?,
        },
        hisat2_version: hisat2_version.into(),
        build_arguments: plan.command.args.clone(),
        index_format: inspection.format.unwrap_or_default(),
        files,
        started_at,
        completed_at: timestamp(),
        validation: "all eight HISAT2 index files are present and checksummed".into(),
    };
    let manifest_path = plan.temporary_dir.join("index-manifest.json");
    let text = serde_json::to_string_pretty(&manifest).map_err(|error| {
        DesktopError::Process(format!("could not serialize index manifest: {error}"))
    })?;
    fs::write(manifest_path, text).map_err(|error| {
        DesktopError::Process(format!("could not write index manifest: {error}"))
    })?;
    fs::rename(&plan.temporary_dir, &plan.final_directory).map_err(|error| {
        DesktopError::Process(format!("could not atomically publish index: {error}"))
    })?;
    Ok(manifest)
}

pub fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn file_manifest(path: &PathBuf) -> Result<IndexFileManifest, DesktopError> {
    Ok(IndexFileManifest {
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("index-part")
            .into(),
        bytes: fs::metadata(path)
            .map_err(|error| {
                DesktopError::Process(format!("could not inspect index part: {error}"))
            })?
            .len(),
        sha256: sha256_file(path)?,
    })
}

fn sha256_file(path: &Path) -> Result<String, DesktopError> {
    let mut file = fs::File::open(path).map_err(|error| {
        DesktopError::Process(format!("could not open file for checksum: {error}"))
    })?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| DesktopError::Process(format!("could not hash file: {error}")))?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn index_files(prefix: &Path, extension: &str) -> Vec<PathBuf> {
    (1..=8)
        .map(|number| PathBuf::from(format!("{}.{}.{}", prefix.display(), number, extension)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unsafe_index_name() {
        let request = IndexBuildRequest {
            fasta: PathBuf::from(r"C:\ref\genome.fa"),
            cache_dir: PathBuf::from(r"C:\cache"),
            index_name: "..\\escape".into(),
            threads: 4,
        };
        assert!(plan_hisat2_index_build(&request).is_err());
    }
    #[test]
    fn plans_atomic_index_build() {
        let request = IndexBuildRequest {
            fasta: PathBuf::from(r"C:\ref\日本語.fa"),
            cache_dir: PathBuf::from(r"C:\cache"),
            index_name: "arabidopsis".into(),
            threads: 4,
        };
        let plan = plan_hisat2_index_build(&request).unwrap();
        assert!(plan.temporary_prefix.starts_with(&plan.temporary_dir));
        assert_eq!(plan.command.tool, Tool::Hisat2Build);
    }

    #[test]
    fn finalization_writes_manifest_then_publishes_index_directory() {
        let root = std::env::temp_dir().join(format!("rna-seq-index-test-{}", Uuid::new_v4()));
        let fasta = root.join("reference.fa");
        fs::create_dir_all(&root).unwrap();
        fs::write(&fasta, b">chr1\nACGT\n").unwrap();
        let plan = plan_hisat2_index_build(&IndexBuildRequest {
            fasta: fasta.clone(),
            cache_dir: root.clone(),
            index_name: "custom".into(),
            threads: 1,
        })
        .unwrap();
        fs::create_dir_all(&plan.temporary_dir).unwrap();
        for part in 1..=8 {
            fs::write(
                format!("{}.{}.ht2", plan.temporary_prefix.display(), part),
                [part],
            )
            .unwrap();
        }
        let manifest = finalize_index_build(&plan, &fasta, "2.2.3", timestamp()).unwrap();
        assert_eq!(manifest.files.len(), 8);
        assert!(plan.final_directory.join("index-manifest.json").is_file());
        assert!(
            inspect_existing_index(&ExistingIndexRequest {
                prefix: plan.final_prefix
            })
            .unwrap()
            .valid
        );
        let _ = fs::remove_dir_all(root);
    }
}
