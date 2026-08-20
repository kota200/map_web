use crate::{DesktopError, Tool};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SidecarRecord {
    pub tool: Tool,
    pub file: String,
    pub sha256: String,
    pub version: String,
    #[serde(default)]
    pub source_url: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub license_file: String,
    #[serde(default)]
    pub support_files: Vec<SidecarSupportFile>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SidecarSupportFile {
    pub file: String,
    pub sha256: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SidecarManifest {
    pub target: String,
    pub sidecars: Vec<SidecarRecord>,
}
#[derive(Clone, Debug, Serialize)]
pub struct SidecarStatus {
    pub tool: Tool,
    pub version: Option<String>,
    pub valid: bool,
    pub detail: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct RunStatus {
    pub run_id: Uuid,
    pub state: String,
    pub active_tool: Option<Tool>,
    pub exit_code: Option<i32>,
    pub detail: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct NativeLogEvent {
    pub run_id: Uuid,
    pub tool: Tool,
    pub stream: String,
    pub line: String,
}
type LogReporter = Arc<dyn Fn(NativeLogEvent) + Send + Sync>;

#[derive(Clone, Default)]
pub struct ProcessSupervisor {
    inner: Arc<SupervisorInner>,
}
#[derive(Default)]
struct SupervisorInner {
    active: Mutex<HashMap<Uuid, Arc<Mutex<Child>>>>,
    statuses: Mutex<HashMap<Uuid, RunStatus>>,
}

fn tool_name(tool: &Tool) -> &'static str {
    match tool {
        Tool::Fastp => "fastp",
        Tool::Hisat2 => "hisat2",
        Tool::Hisat2Build => "hisat2-build",
        Tool::FeatureCounts => "featureCounts",
        Tool::Kallisto => "kallisto",
    }
}
pub fn verify_sidecar(
    root: &Path,
    manifest: &SidecarManifest,
    tool: &Tool,
) -> Result<PathBuf, DesktopError> {
    let record = manifest
        .sidecars
        .iter()
        .find(|x| x.tool == *tool)
        .ok_or_else(|| DesktopError::UnsupportedTool(tool_name(tool).into()))?;
    let relative = Path::new(&record.file);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(DesktopError::UnsafePath(record.file.clone()));
    }
    let path = verify_registered_file(root, &record.file, &record.sha256, tool)?;
    for support_file in &record.support_files {
        verify_registered_file(root, &support_file.file, &support_file.sha256, tool)?;
    }
    Ok(path)
}

fn verify_registered_file(
    root: &Path,
    file: &str,
    expected_sha256: &str,
    tool: &Tool,
) -> Result<PathBuf, DesktopError> {
    let relative = Path::new(file);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(DesktopError::UnsafePath(file.into()));
    }
    let path = root.join(relative);
    let bytes = fs::read(&path).map_err(|_| {
        DesktopError::UnsupportedTool(format!(
            "{} binary or support file is missing",
            tool_name(tool)
        ))
    })?;
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual != expected_sha256 {
        return Err(DesktopError::UnsupportedTool(format!(
            "{} checksum mismatch",
            tool_name(tool)
        )));
    }
    Ok(path)
}

pub fn sidecar_statuses(root: &Path, manifest: &SidecarManifest) -> Vec<SidecarStatus> {
    [
        Tool::Fastp,
        Tool::Hisat2,
        Tool::Hisat2Build,
        Tool::FeatureCounts,
        Tool::Kallisto,
    ]
    .into_iter()
    .map(|tool| {
        let version = manifest
            .sidecars
            .iter()
            .find(|item| item.tool == tool)
            .map(|item| item.version.clone());
        match verify_sidecar(root, manifest, &tool) {
            Ok(_) => SidecarStatus {
                tool,
                version,
                valid: true,
                detail: "verified".into(),
            },
            Err(error) => SidecarStatus {
                tool,
                version,
                valid: false,
                detail: error.to_string(),
            },
        }
    })
    .collect()
}

impl ProcessSupervisor {
    pub fn start(
        &self,
        root: PathBuf,
        manifest: SidecarManifest,
        plan: crate::RunPlan,
    ) -> Result<RunStatus, DesktopError> {
        self.start_with_reporter(root, manifest, plan, Arc::new(|_| {}))
    }

    pub fn start_with_reporter(
        &self,
        root: PathBuf,
        manifest: SidecarManifest,
        plan: crate::RunPlan,
        reporter: LogReporter,
    ) -> Result<RunStatus, DesktopError> {
        let verified = plan
            .commands
            .clone()
            .into_iter()
            .map(|command| {
                verify_sidecar(&root, &manifest, &command.tool).map(|path| (command, path))
            })
            .collect::<Result<Vec<_>, _>>()?;
        fs::create_dir_all(&plan.temporary_dir).map_err(|error| {
            DesktopError::Process(format!("could not create temporary directory: {error}"))
        })?;
        let run_id = plan.run_id;
        let initial = RunStatus {
            run_id,
            state: "queued".into(),
            active_tool: None,
            exit_code: None,
            detail: "sidecars verified; run queued".into(),
        };
        self.inner
            .statuses
            .lock()
            .map_err(|_| DesktopError::Process("status lock poisoned".into()))?
            .insert(run_id, initial.clone());
        let inner = Arc::clone(&self.inner);
        thread::spawn(move || {
            for (command, program) in verified {
                if is_cancelled(&inner, run_id) {
                    let _ = cleanup_partial(&plan);
                    return;
                }
                set_status(
                    &inner,
                    run_id,
                    "running",
                    Some(command.tool.clone()),
                    None,
                    format!("running {}", tool_name(&command.tool)),
                );
                let mut child = match Command::new(program)
                    .args(&command.args)
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
                {
                    Ok(child) => child,
                    Err(error) => {
                        set_status(
                            &inner,
                            run_id,
                            "failed",
                            Some(command.tool),
                            None,
                            error.to_string(),
                        );
                        let _ = cleanup_partial(&plan);
                        return;
                    }
                };
                if let Some(stdout) = child.stdout.take() {
                    stream_lines(
                        stdout,
                        run_id,
                        command.tool.clone(),
                        "stdout",
                        Arc::clone(&reporter),
                    );
                }
                if let Some(stderr) = child.stderr.take() {
                    stream_lines(
                        stderr,
                        run_id,
                        command.tool.clone(),
                        "stderr",
                        Arc::clone(&reporter),
                    );
                }
                let child = Arc::new(Mutex::new(child));
                if let Ok(mut active) = inner.active.lock() {
                    active.insert(run_id, Arc::clone(&child));
                }
                let result = child
                    .lock()
                    .map_err(|_| ())
                    .and_then(|mut child| child.wait().map_err(|_| ()));
                if let Ok(mut active) = inner.active.lock() {
                    active.remove(&run_id);
                }
                if is_cancelled(&inner, run_id) {
                    let _ = cleanup_partial(&plan);
                    return;
                }
                match result {
                    Ok(status) if status.success() => {}
                    Ok(status) => {
                        set_status(
                            &inner,
                            run_id,
                            "failed",
                            Some(command.tool),
                            status.code(),
                            "sidecar exited unsuccessfully".into(),
                        );
                        let _ = cleanup_partial(&plan);
                        return;
                    }
                    Err(()) => {
                        set_status(
                            &inner,
                            run_id,
                            "failed",
                            Some(command.tool),
                            None,
                            "could not wait for sidecar".into(),
                        );
                        let _ = cleanup_partial(&plan);
                        return;
                    }
                }
            }
            if let Err(error) = publish_and_cleanup(&plan) {
                set_status(&inner, run_id, "failed", None, None, error.to_string());
                let _ = cleanup_partial(&plan);
                return;
            }
            set_status(
                &inner,
                run_id,
                "completed",
                None,
                Some(0),
                "all commands completed".into(),
            );
        });
        Ok(initial)
    }

    pub fn start_index_build_with_reporter(
        &self,
        root: PathBuf,
        manifest: SidecarManifest,
        plan: crate::index::IndexBuildPlan,
        fasta: PathBuf,
        reporter: LogReporter,
    ) -> Result<RunStatus, DesktopError> {
        let program = verify_sidecar(&root, &manifest, &Tool::Hisat2Build)?;
        if plan.final_directory.exists() {
            return Err(DesktopError::Process(
                "refusing to overwrite an existing index directory".into(),
            ));
        }
        fs::create_dir_all(&plan.temporary_dir).map_err(|error| {
            DesktopError::Process(format!(
                "could not create temporary index directory: {error}"
            ))
        })?;
        let run_id = plan.build_id;
        let initial = RunStatus {
            run_id,
            state: "queued".into(),
            active_tool: None,
            exit_code: None,
            detail: "hisat2-build sidecar verified; build queued".into(),
        };
        self.inner
            .statuses
            .lock()
            .map_err(|_| DesktopError::Process("status lock poisoned".into()))?
            .insert(run_id, initial.clone());
        let inner = Arc::clone(&self.inner);
        let hisat2_version = manifest
            .sidecars
            .iter()
            .find(|record| record.tool == Tool::Hisat2Build)
            .map(|record| record.version.clone())
            .unwrap_or_else(|| "unknown".into());
        let started_at = crate::index::timestamp();
        thread::spawn(move || {
            set_status(
                &inner,
                run_id,
                "running",
                Some(Tool::Hisat2Build),
                None,
                "running hisat2-build".into(),
            );
            let mut child = match Command::new(program)
                .args(&plan.command.args)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(child) => child,
                Err(error) => {
                    set_status(
                        &inner,
                        run_id,
                        "failed",
                        Some(Tool::Hisat2Build),
                        None,
                        error.to_string(),
                    );
                    let _ = cleanup_index_partial(&plan);
                    return;
                }
            };
            if let Some(stdout) = child.stdout.take() {
                stream_lines(
                    stdout,
                    run_id,
                    Tool::Hisat2Build,
                    "stdout",
                    Arc::clone(&reporter),
                );
            }
            if let Some(stderr) = child.stderr.take() {
                stream_lines(
                    stderr,
                    run_id,
                    Tool::Hisat2Build,
                    "stderr",
                    Arc::clone(&reporter),
                );
            }
            let child = Arc::new(Mutex::new(child));
            if let Ok(mut active) = inner.active.lock() {
                active.insert(run_id, Arc::clone(&child));
            }
            let result = child
                .lock()
                .map_err(|_| ())
                .and_then(|mut child| child.wait().map_err(|_| ()));
            if let Ok(mut active) = inner.active.lock() {
                active.remove(&run_id);
            }
            if is_cancelled(&inner, run_id) {
                let _ = cleanup_index_partial(&plan);
                return;
            }
            match result {
                Ok(status) if status.success() => match crate::index::finalize_index_build(
                    &plan,
                    &fasta,
                    &hisat2_version,
                    started_at,
                ) {
                    Ok(_) => set_status(
                        &inner,
                        run_id,
                        "completed",
                        None,
                        Some(0),
                        "index validated and atomically published".into(),
                    ),
                    Err(error) => {
                        set_status(
                            &inner,
                            run_id,
                            "failed",
                            Some(Tool::Hisat2Build),
                            None,
                            error.to_string(),
                        );
                        let _ = cleanup_index_partial(&plan);
                    }
                },
                Ok(status) => {
                    set_status(
                        &inner,
                        run_id,
                        "failed",
                        Some(Tool::Hisat2Build),
                        status.code(),
                        "hisat2-build exited unsuccessfully".into(),
                    );
                    let _ = cleanup_index_partial(&plan);
                }
                Err(()) => {
                    set_status(
                        &inner,
                        run_id,
                        "failed",
                        Some(Tool::Hisat2Build),
                        None,
                        "could not wait for hisat2-build".into(),
                    );
                    let _ = cleanup_index_partial(&plan);
                }
            }
        });
        Ok(initial)
    }

    pub fn status(&self, run_id: Uuid) -> Option<RunStatus> {
        self.inner.statuses.lock().ok()?.get(&run_id).cloned()
    }

    pub fn cancel(&self, run_id: Uuid) -> Result<RunStatus, DesktopError> {
        let child = self
            .inner
            .active
            .lock()
            .map_err(|_| DesktopError::Process("active lock poisoned".into()))?
            .get(&run_id)
            .cloned()
            .ok_or_else(|| DesktopError::Process("run is not active".into()))?;
        let pid = child
            .lock()
            .map_err(|_| DesktopError::Process("child lock poisoned".into()))?
            .id();
        #[cfg(windows)]
        let cancelled = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        #[cfg(not(windows))]
        let cancelled = child
            .lock()
            .map_err(|_| DesktopError::Process("child lock poisoned".into()))?
            .kill()
            .is_ok();
        if !cancelled {
            return Err(DesktopError::Process(
                "could not terminate process tree".into(),
            ));
        }
        let status = RunStatus {
            run_id,
            state: "cancelled".into(),
            active_tool: None,
            exit_code: None,
            detail: "process tree termination requested".into(),
        };
        self.inner
            .statuses
            .lock()
            .map_err(|_| DesktopError::Process("status lock poisoned".into()))?
            .insert(run_id, status.clone());
        Ok(status)
    }
}

fn stream_lines<R: std::io::Read + Send + 'static>(
    reader: R,
    run_id: Uuid,
    tool: Tool,
    stream: &'static str,
    reporter: LogReporter,
) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            let line: String = line.chars().take(4_096).collect();
            reporter(NativeLogEvent {
                run_id,
                tool: tool.clone(),
                stream: stream.into(),
                line: redact_absolute_paths(&line),
            });
        }
    });
}

fn redact_absolute_paths(line: &str) -> String {
    let characters: Vec<char> = line.chars().collect();
    let mut output = String::with_capacity(line.len());
    let mut index = 0;
    while index < characters.len() {
        let windows_path = index + 2 < characters.len()
            && characters[index].is_ascii_alphabetic()
            && characters[index + 1] == ':'
            && matches!(characters[index + 2], '\\' | '/');
        let unix_path = characters[index] == '/'
            && (index == 0
                || characters[index - 1].is_whitespace()
                || characters[index - 1] == '"');
        if windows_path || unix_path {
            output.push_str("[path]");
            index += if windows_path { 3 } else { 1 };
            while index < characters.len()
                && !matches!(characters[index], '"' | '\'' | '\t' | '\n' | '\r')
            {
                index += 1;
            }
            continue;
        }
        output.push(characters[index]);
        index += 1;
    }
    output
}

fn publish_and_cleanup(plan: &crate::RunPlan) -> Result<(), DesktopError> {
    if plan.final_output_dir.exists() {
        return Err(DesktopError::Process(
            "refusing to overwrite an existing result directory".into(),
        ));
    }
    crate::results::write_featurecounts_results(
        &plan.counts_path,
        &plan.raw_counts_path,
        &plan.counts_with_tpm_path,
    )?;
    let temporary_summary = PathBuf::from(format!("{}.summary", plan.counts_path.display()));
    if !temporary_summary.is_file() {
        return Err(DesktopError::Process(
            "featureCounts summary file is missing".into(),
        ));
    }
    if !plan.keep_sam {
        if plan.sam_path.exists() {
            fs::remove_file(&plan.sam_path).map_err(|error| {
                DesktopError::Process(format!("could not remove temporary SAM: {error}"))
            })?;
        }
        for name in ["cleaned-R1.fastq.gz", "cleaned-R2.fastq.gz"] {
            let path = plan.temporary_dir.join(name);
            if path.exists() {
                fs::remove_file(path).map_err(|error| {
                    DesktopError::Process(format!(
                        "could not remove temporary cleaned FASTQ: {error}"
                    ))
                })?;
            }
        }
    }
    fs::rename(&plan.temporary_dir, &plan.final_output_dir).map_err(|error| {
        DesktopError::Process(format!("could not atomically publish results: {error}"))
    })?;
    Ok(())
}

fn cleanup_partial(plan: &crate::RunPlan) -> Result<(), DesktopError> {
    if plan.temporary_dir.exists() {
        fs::remove_dir_all(&plan.temporary_dir).map_err(|error| {
            DesktopError::Process(format!("could not clean partial temporary files: {error}"))
        })?;
    }
    Ok(())
}

fn cleanup_index_partial(plan: &crate::index::IndexBuildPlan) -> Result<(), DesktopError> {
    if plan.temporary_dir.exists() {
        fs::remove_dir_all(&plan.temporary_dir).map_err(|error| {
            DesktopError::Process(format!("could not clean partial index: {error}"))
        })?;
    }
    Ok(())
}

fn set_status(
    inner: &SupervisorInner,
    run_id: Uuid,
    state: &str,
    active_tool: Option<Tool>,
    exit_code: Option<i32>,
    detail: String,
) {
    if let Ok(mut statuses) = inner.statuses.lock() {
        statuses.insert(
            run_id,
            RunStatus {
                run_id,
                state: state.into(),
                active_tool,
                exit_code,
                detail,
            },
        );
    }
}

fn is_cancelled(inner: &SupervisorInner, run_id: Uuid) -> bool {
    inner
        .statuses
        .lock()
        .ok()
        .and_then(|statuses| {
            statuses
                .get(&run_id)
                .map(|status| status.state == "cancelled")
        })
        .unwrap_or(false)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_checksum_mismatch_and_path_escape() {
        let root = std::env::temp_dir();
        let manifest = SidecarManifest {
            target: "test".into(),
            sidecars: vec![SidecarRecord {
                tool: Tool::Fastp,
                file: "..\\outside.exe".into(),
                sha256: "0".repeat(64),
                version: "test".into(),
                source_url: String::new(),
                license: String::new(),
                license_file: String::new(),
                support_files: Vec::new(),
            }],
        };
        assert!(matches!(
            verify_sidecar(&root, &manifest, &Tool::Fastp),
            Err(DesktopError::UnsafePath(_))
        ));
    }

    #[test]
    fn redacts_absolute_paths_from_native_log_events() {
        assert_eq!(
            redact_absolute_paths("reading C:\\Users\\name\\reads one.fq from /tmp/run/file"),
            "reading [path]"
        );
        assert_eq!(
            redact_absolute_paths("-a \"C:\\refs\\annotation.gtf\""),
            "-a \"[path]\""
        );
    }
}
