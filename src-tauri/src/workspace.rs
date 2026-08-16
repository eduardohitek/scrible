use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
pub struct WorkspacePaths {
    pub root: PathBuf,
    pub hidden: PathBuf,
}

#[derive(Debug, Clone, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum WorkspaceError {
    #[error("sem permissão de escrita em {0}")]
    PermissionDenied(String),
    #[error("falha de I/O: {0}")]
    Io(String),
}

impl From<io::Error> for WorkspaceError {
    fn from(err: io::Error) -> Self {
        if err.kind() == io::ErrorKind::PermissionDenied {
            WorkspaceError::PermissionDenied(err.to_string())
        } else {
            WorkspaceError::Io(err.to_string())
        }
    }
}

/// Garante que `{base}/scrible/` e `{base}/scrible/.scrible/` existem, criando-as
/// se necessário. Não recria nem apaga nada se já existirem. Função pura, sem
/// dependência do runtime do Tauri — testável isoladamente.
pub fn ensure_workspace(base: &Path) -> Result<WorkspacePaths, WorkspaceError> {
    let root = base.join("scrible");
    let hidden = root.join(".scrible");

    fs::create_dir_all(&hidden)?;

    // `create_dir_all` só falha se precisar criar o diretório. Se ele já existia
    // mas está sem permissão de escrita, precisamos de uma prova de escrita real.
    let probe = hidden.join(".write-check");
    fs::write(&probe, b"")?;
    fs::remove_file(&probe)?;

    Ok(WorkspacePaths { root, hidden })
}

/// Resolve o diretório Documents do usuário via API do Tauri e delega a
/// criação idempotente para `ensure_workspace`.
pub fn bootstrap(app: &AppHandle) -> Result<WorkspacePaths, WorkspaceError> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|err| WorkspaceError::Io(err.to_string()))?;

    ensure_workspace(&documents)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn creates_workspace_dirs_on_first_run() {
        let tmp = tempfile::tempdir().unwrap();

        let paths = ensure_workspace(tmp.path()).unwrap();

        assert!(paths.root.is_dir());
        assert!(paths.hidden.is_dir());
        assert_eq!(paths.root, tmp.path().join("scrible"));
        assert_eq!(paths.hidden, tmp.path().join("scrible").join(".scrible"));
    }

    #[test]
    fn second_run_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();

        let first = ensure_workspace(tmp.path()).unwrap();

        // Marca o diretório com um arquivo para garantir que a segunda chamada
        // não apaga nem recria nada existente.
        let marker = first.root.join("nao-mexer.txt");
        fs::write(&marker, b"conteudo do usuario").unwrap();

        let second = ensure_workspace(tmp.path()).unwrap();

        assert_eq!(first.root, second.root);
        assert_eq!(first.hidden, second.hidden);
        assert!(marker.is_file());
        assert_eq!(fs::read_to_string(&marker).unwrap(), "conteudo do usuario");
    }

    #[cfg(unix)]
    #[test]
    fn reports_permission_denied_on_existing_readonly_dir() {
        let tmp = tempfile::tempdir().unwrap();

        // Primeiro cria normalmente, depois remove a permissão de escrita
        // do diretório oculto para simular um workspace pré-existente e
        // não gravável (disco montado read-only, permissões trocadas, etc.).
        let paths = ensure_workspace(tmp.path()).unwrap();
        let mut perms = fs::metadata(&paths.hidden).unwrap().permissions();
        perms.set_mode(0o500);
        fs::set_permissions(&paths.hidden, perms).unwrap();

        let result = ensure_workspace(tmp.path());

        // Restaura a permissão para o TempDir conseguir se limpar no Drop.
        let mut restore = fs::metadata(&paths.hidden).unwrap().permissions();
        restore.set_mode(0o700);
        fs::set_permissions(&paths.hidden, restore).unwrap();

        assert!(matches!(result, Err(WorkspaceError::PermissionDenied(_))));
    }
}
