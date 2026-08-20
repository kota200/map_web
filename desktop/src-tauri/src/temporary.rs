use crate::{checked, DesktopError};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};
use uuid::Uuid;

const TEMP_ROOTS: [&str; 2] = [".rna-seq-tmp", ".rna-seq-index-tmp"];

#[derive(Clone, Debug, Serialize)]
pub struct OrphanTemporaryDirectory {
    pub path: PathBuf,
    pub kind: String,
    pub bytes: u64,
    pub age_seconds: u64,
}

pub fn find_orphan_temporary_directories(
    root: &Path,
) -> Result<Vec<OrphanTemporaryDirectory>, DesktopError> {
    checked(root)?;
    let mut orphans = Vec::new();
    for name in TEMP_ROOTS {
        let base = root.join(name);
        if !base.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&base).map_err(|error| {
            DesktopError::Process(format!("could not inspect temporary directory: {error}"))
        })? {
            let entry = entry.map_err(|error| {
                DesktopError::Process(format!("could not inspect temporary entry: {error}"))
            })?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| {
                DesktopError::Process(format!(
                    "could not inspect temporary entry metadata: {error}"
                ))
            })?;
            if !metadata.file_type().is_dir()
                || metadata.file_type().is_symlink()
                || Uuid::parse_str(&entry.file_name().to_string_lossy()).is_err()
            {
                continue;
            }
            let age_seconds = metadata
                .modified()
                .ok()
                .and_then(|time| SystemTime::now().duration_since(time).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            orphans.push(OrphanTemporaryDirectory {
                path,
                kind: name.trim_matches('.').into(),
                bytes: directory_bytes(&entry.path()),
                age_seconds,
            });
        }
    }
    Ok(orphans)
}

pub fn cleanup_orphan_temporary_directories(
    root: &Path,
) -> Result<Vec<OrphanTemporaryDirectory>, DesktopError> {
    let orphans = find_orphan_temporary_directories(root)?;
    for orphan in &orphans {
        fs::remove_dir_all(&orphan.path).map_err(|error| {
            DesktopError::Process(format!(
                "could not remove orphan temporary directory {}: {error}",
                orphan.path.display()
            ))
        })?;
    }
    Ok(orphans)
}

fn directory_bytes(path: &Path) -> u64 {
    fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| {
            entry
                .metadata()
                .ok()
                .map(|metadata| {
                    if metadata.is_dir() {
                        directory_bytes(&entry.path())
                    } else {
                        metadata.len()
                    }
                })
                .unwrap_or(0)
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_returns_uuid_children_of_known_temp_roots() {
        let root = std::env::temp_dir().join(format!("rna-seq-orphan-test-{}", Uuid::new_v4()));
        let orphan = root.join(".rna-seq-tmp").join(Uuid::new_v4().to_string());
        fs::create_dir_all(&orphan).unwrap();
        fs::write(orphan.join("partial.sam"), b"partial").unwrap();
        fs::create_dir_all(root.join(".rna-seq-tmp").join("not-a-uuid")).unwrap();
        assert_eq!(find_orphan_temporary_directories(&root).unwrap().len(), 1);
        assert_eq!(
            cleanup_orphan_temporary_directories(&root).unwrap().len(),
            1
        );
        assert!(!orphan.exists());
        let _ = fs::remove_dir_all(root);
    }
}
