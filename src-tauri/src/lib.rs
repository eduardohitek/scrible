mod workspace;

use tauri::Manager;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let result = workspace::bootstrap(app.handle());
            if let Err(err) = &result {
                eprintln!("falha ao inicializar o workspace: {err}");
            }
            app.manage(WorkspaceState(result));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, workspace_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
