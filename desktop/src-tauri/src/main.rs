use rna_seq_local_desktop::{
    index::{
        inspect_existing_index as inspect_index, plan_hisat2_index_build as create_index_plan,
        ExistingIndexRequest, IndexBuildPlan, IndexBuildRequest, IndexInspection,
    },
    plan_hisat2,
    sidecars::{
        sidecar_statuses, verify_bundled_sidecar_versions, ProcessSupervisor, RunStatus,
        SidecarManifest, SidecarStatus,
    },
    Hisat2Request, RunPlan,
};
use std::{fs, path::PathBuf, sync::Arc};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

struct AppState {
    sidecar_root: PathBuf,
    manifest: SidecarManifest,
    supervisor: ProcessSupervisor,
}

fn load_state(sidecar_root: PathBuf, manifest_path: PathBuf) -> Result<AppState, String> {
    let manifest = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("sidecar manifest is unavailable: {error}"))
        .and_then(|text| {
            serde_json::from_str(&text)
                .map_err(|error| format!("sidecar manifest is invalid: {error}"))
        })?;
    Ok(AppState {
        sidecar_root,
        manifest,
        supervisor: ProcessSupervisor::default(),
    })
}

#[tauri::command]
fn plan_hisat2_run(request: Hisat2Request) -> Result<rna_seq_local_desktop::RunPlan, String> {
    plan_hisat2(&request).map_err(|e| e.to_string())
}

#[tauri::command]
fn inspect_hisat2_index(request: ExistingIndexRequest) -> Result<IndexInspection, String> {
    inspect_index(&request).map_err(|error| error.to_string())
}

#[tauri::command]
fn plan_hisat2_index_build(request: IndexBuildRequest) -> Result<IndexBuildPlan, String> {
    create_index_plan(&request).map_err(|error| error.to_string())
}

#[tauri::command]
fn start_hisat2_index_build(
    request: IndexBuildRequest,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<RunStatus, String> {
    let plan = create_index_plan(&request).map_err(|error| error.to_string())?;
    state
        .supervisor
        .start_index_build_with_reporter(
            state.sidecar_root.clone(),
            state.manifest.clone(),
            plan,
            request.fasta,
            Arc::new(move |event| {
                let _ = app.emit("native-log", event);
            }),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn verify_sidecars(state: State<'_, AppState>) -> Vec<SidecarStatus> {
    sidecar_statuses(&state.sidecar_root, &state.manifest)
}

#[tauri::command]
fn start_hisat2_run(
    request: Hisat2Request,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<RunStatus, String> {
    let plan: RunPlan = plan_hisat2(&request).map_err(|error| error.to_string())?;
    state
        .supervisor
        .start_with_reporter(
            state.sidecar_root.clone(),
            state.manifest.clone(),
            plan,
            Arc::new(move |event| {
                let _ = app.emit("native-log", event);
            }),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_run_status(run_id: Uuid, state: State<'_, AppState>) -> Option<RunStatus> {
    state.supervisor.status(run_id)
}

#[tauri::command]
fn cancel_run(run_id: Uuid, state: State<'_, AppState>) -> Result<RunStatus, String> {
    state
        .supervisor
        .cancel(run_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn find_orphan_temporary_directories(
    root: PathBuf,
) -> Result<Vec<rna_seq_local_desktop::temporary::OrphanTemporaryDirectory>, String> {
    rna_seq_local_desktop::temporary::find_orphan_temporary_directories(&root)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn cleanup_orphan_temporary_directories(
    root: PathBuf,
) -> Result<Vec<rna_seq_local_desktop::temporary::OrphanTemporaryDirectory>, String> {
    rna_seq_local_desktop::temporary::cleanup_orphan_temporary_directories(&root)
        .map_err(|error| error.to_string())
}

fn main() {
    if std::env::args_os().any(|argument| argument == "--verify-bundled-sidecars") {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let state = load_state(root.clone(), root.join("sidecars.windows-x86_64.json"))
            .unwrap_or_else(|error| {
                eprintln!("{error}");
                std::process::exit(1);
            });
        let evidence =
            verify_bundled_sidecar_versions(&root, &state.manifest).unwrap_or_else(|error| {
                eprintln!("{error}");
                std::process::exit(1);
            });
        for item in evidence {
            println!("{:?}\t{}\t{}", item.tool, item.version, item.output);
        }
        return;
    }
    tauri::Builder::default()
        .setup(|app| {
            let (sidecar_root, manifest_path) = if cfg!(debug_assertions) {
                let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
                (root.clone(), root.join("sidecars.windows-x86_64.json"))
            } else {
                let sidecars = app
                    .path()
                    .executable_dir()
                    .unwrap_or_else(|error| panic!("could not locate bundled sidecars: {error}"));
                let manifest = app
                    .path()
                    .resource_dir()
                    .unwrap_or_else(|error| panic!("could not locate bundled resources: {error}"))
                    .join("sidecars.windows-x86_64.json");
                (sidecars, manifest)
            };
            app.manage(
                load_state(sidecar_root, manifest_path).unwrap_or_else(|error| panic!("{error}")),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            plan_hisat2_run,
            inspect_hisat2_index,
            plan_hisat2_index_build,
            start_hisat2_index_build,
            verify_sidecars,
            start_hisat2_run,
            get_run_status,
            cancel_run,
            find_orphan_temporary_directories,
            cleanup_orphan_temporary_directories
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri desktop app");
}
