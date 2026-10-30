mod app_menu;
mod file_index;
mod fs_ops;
mod history;
mod open_paths;
mod pdf_export;
mod session;
mod tree_watcher;
mod watcher;
mod workspace;

use std::path::PathBuf;

use fs_ops::FsError;
use history::{HistoryError, RestoreResult, SnapshotInfo};
use open_paths::PendingOpenPaths;
use session::{Session, SessionError};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use watcher::LastSaveMtime;
use workspace::{WorkspaceError, WorkspacePaths};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

struct WorkspaceState(Result<WorkspacePaths, WorkspaceError>);

#[tauri::command]
fn workspace_status(state: tauri::State<WorkspaceState>) -> Result<WorkspacePaths, WorkspaceError> {
    state.0.clone()
}

#[tauri::command]
fn read_file(path: String) -> Result<String, FsError> {
    fs_ops::read_file(&PathBuf::from(path))
}

#[tauri::command]
fn save_file(
    path: String,
    content: String,
    expected_mtime: Option<i64>,
    state: tauri::State<WorkspaceState>,
    last_save_mtime: tauri::State<LastSaveMtime>,
) -> Result<i64, FsError> {
    let file_path = PathBuf::from(path);
    let new_mtime = fs_ops::save_file(&file_path, &content, expected_mtime)?;
    last_save_mtime.record(new_mtime);

    if let Ok(workspace) = &state.0 {
        if let Err(err) = history::maybe_snapshot(&workspace.hidden, &file_path, &content) {
            eprintln!("falha ao criar snapshot de histórico: {err}");
        }
    }

    Ok(new_mtime)
}

#[tauri::command]
fn snapshot_before_discard(
    path: String,
    content: String,
    state: tauri::State<WorkspaceState>,
) -> Result<(), HistoryError> {
    let workspace = state.0.as_ref().map_err(|err| HistoryError::Io {
        message: err.to_string(),
    })?;
    history::force_snapshot(&workspace.hidden, &PathBuf::from(path), &content)
}

#[tauri::command]
fn list_snapshots(path: String, state: tauri::State<WorkspaceState>) -> Result<Vec<SnapshotInfo>, HistoryError> {
    let workspace = state.0.as_ref().map_err(|err| HistoryError::Io {
        message: err.to_string(),
    })?;
    history::list_snapshots(&workspace.hidden, &PathBuf::from(path))
}

#[tauri::command]
fn restore_snapshot(
    path: String,
    timestamp: i64,
    state: tauri::State<WorkspaceState>,
) -> Result<RestoreResult, HistoryError> {
    let workspace = state.0.as_ref().map_err(|err| HistoryError::Io {
        message: err.to_string(),
    })?;
    history::restore_snapshot(&workspace.hidden, &PathBuf::from(path), timestamp)
}

#[tauri::command]
fn read_session(state: tauri::State<WorkspaceState>) -> Session {
    match &state.0 {
        Ok(workspace) => session::load(&workspace.hidden),
        Err(_) => Session::default(),
    }
}

#[tauri::command]
fn write_session(session: Session, state: tauri::State<WorkspaceState>) -> Result<(), SessionError> {
    let workspace = state.0.as_ref().map_err(|err| SessionError::Io(err.to_string()))?;
    session::save(&workspace.hidden, &session)
}

#[tauri::command]
fn write_export_file(path: String, content: String) -> Result<(), FsError> {
    fs_ops::write_export_file(&PathBuf::from(path), &content)
}

#[tauri::command]
async fn export_pdf(app: AppHandle, html: String, path: String) -> Result<(), pdf_export::PdfExportError> {
    let bytes = pdf_export::render_html_to_pdf(&app, html).await?;
    std::fs::write(&path, bytes)?;
    Ok(())
}

#[tauri::command]
fn rename_file(from: String, to: String) -> Result<(), FsError> {
    fs_ops::rename_file(&PathBuf::from(from), &PathBuf::from(to))
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), FsError> {
    fs_ops::delete_file(&PathBuf::from(path))
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<String>, FsError> {
    fs_ops::list_dir(&PathBuf::from(path))
}

#[tauri::command]
fn list_dir_entries(path: String) -> Result<Vec<fs_ops::DirEntry>, FsError> {
    fs_ops::list_dir_entries(&PathBuf::from(path))
}

#[tauri::command]
async fn list_workspace_files(state: tauri::State<'_, WorkspaceState>) -> Result<Vec<String>, FsError> {
    let root = state.0.as_ref().map_err(|err| FsError::Io { message: err.to_string() })?.root.clone();
    tauri::async_runtime::spawn_blocking(move || file_index::scan(&root))
        .await.map_err(|err| FsError::Io { message: err.to_string() })?
}

/// Links `.md` do preview só abrem aba de arquivo existente — `openTab` cria
/// arquivos ausentes, e um link quebrado não pode virar arquivo vazio no disco.
#[tauri::command]
fn check_workspace_file(path: String, state: tauri::State<WorkspaceState>) -> Result<(), FsError> {
    let root = &state.0.as_ref().map_err(|err| FsError::Io { message: err.to_string() })?.root;
    file_index::workspace_file(root, &PathBuf::from(path)).map(|_| ())
}

#[tauri::command]
fn open_workspace_file(app: AppHandle, path: String, state: tauri::State<WorkspaceState>) -> Result<(), FsError> {
    let root = &state.0.as_ref().map_err(|err| FsError::Io { message: err.to_string() })?.root;
    let path = file_index::openable_workspace_file(root, &PathBuf::from(path))?;
    app.opener().open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|err| FsError::Io { message: err.to_string() })
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), FsError> {
    fs_ops::create_dir(&PathBuf::from(path))
}

#[tauri::command]
fn delete_dir(path: String) -> Result<(), FsError> {
    fs_ops::delete_dir(&PathBuf::from(path))
}

/// Filtra paths vindos de fora do processo (#102) — ver `open_paths::validate`.
#[tauri::command]
fn validate_open_paths(paths: Vec<String>) -> Vec<String> {
    open_paths::validate(paths)
}

/// Paths que o SO entregou antes de o frontend estar pronto; consumido uma
/// única vez no boot, depois da restauração da sessão (#102).
#[tauri::command]
fn take_pending_open_paths(pending: tauri::State<PendingOpenPaths>) -> Vec<String> {
    pending.take()
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Arquivos entregues pelo SO ("Abrir com", arrastar para o Dock — #103).
/// Antes de o frontend consumir a fila no boot, ficam em `PendingOpenPaths`;
/// depois, vão pelo evento `open-paths` e a janela vem para a frente.
#[cfg(target_os = "macos")]
fn deliver_opened_paths(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let Some(paths) = app.state::<PendingOpenPaths>().enqueue_unless_ready(paths) else {
        return;
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("open-paths", paths);
    }
}

fn handle_run_event(app: &AppHandle, event: tauri::RunEvent) {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Opened { urls } = event {
        deliver_opened_paths(app, open_paths::file_urls_to_paths(&urls));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Gerenciado no Builder (não no `setup`): no macOS, `RunEvent::Opened`
        // de um app aberto por "Abrir com" pode chegar antes do `setup`.
        .manage(PendingOpenPaths::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("app-close-requested", ());
            }
        })
        .setup(|app| {
            let result = workspace::bootstrap(app.handle());
            if let Err(err) = &result {
                eprintln!("falha ao inicializar o workspace: {err}");
            }

            let last_save_mtime = LastSaveMtime::default();
            if let Ok(paths) = &result {
                app.asset_protocol_scope().allow_directory(&paths.root, true)?;
                let target = paths.root.join("untitled.md");
                watcher::start_watching(app.handle().clone(), target, last_save_mtime.clone());
                tree_watcher::start_watching(app.handle().clone(), paths.root.clone(), paths.hidden.clone());
            }

            app.manage(WorkspaceState(result));
            app.manage(last_save_mtime);

            app.set_menu(app_menu::build(app.handle())?)?;
            app.on_menu_event(|app, event| {
                let id = event.id().0.as_str();
                if id == "quit" {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.close();
                    }
                    return;
                }
                let _ = app.emit("menu", id);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            workspace_status,
            read_file,
            save_file,
            write_export_file,
            export_pdf,
            rename_file,
            delete_file,
            list_dir,
            list_dir_entries,
            list_workspace_files,
            check_workspace_file,
            open_workspace_file,
            create_dir,
            delete_dir,
            quit_app,
            list_snapshots,
            restore_snapshot,
            snapshot_before_discard,
            read_session,
            write_session,
            validate_open_paths,
            take_pending_open_paths
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(handle_run_event);
}
