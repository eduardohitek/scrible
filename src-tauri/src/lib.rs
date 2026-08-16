mod fs_ops;
mod workspace;

use std::path::PathBuf;

use fs_ops::FsError;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
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
fn save_file(path: String, content: String, expected_mtime: Option<i64>) -> Result<i64, FsError> {
    fs_ops::save_file(&PathBuf::from(path), &content, expected_mtime)
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
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            app.manage(WorkspaceState(result));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            workspace_status,
            read_file,
            save_file,
            rename_file,
            delete_file,
            list_dir,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
