use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const SESSION_FILE: &str = "session.json";

#[derive(Debug, Clone, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum SessionError {
    #[error("falha de I/O: {0}")]
    Io(String),
}

impl From<io::Error> for SessionError {
    fn from(err: io::Error) -> Self {
        SessionError::Io(err.to_string())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub path: String,
    #[serde(default)]
    pub cursor_pos: usize,
    #[serde(default)]
    pub scroll_top: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    #[serde(default)]
    pub tabs: Vec<SessionTab>,
    #[serde(default)]
    pub active_tab_index: usize,
}

fn session_path(hidden: &Path) -> PathBuf {
    hidden.join(SESSION_FILE)
}

/// Lê `session.json`, descartando abas cujo arquivo não existe mais em disco
/// (apagado/movido por fora entre sessões) com um aviso em stderr. Arquivo
/// ausente (primeira execução) ou corrompido devolve a sessão vazia — nunca
/// deve impedir o app de abrir. `active_tab_index` é reapontado para a mesma
/// aba depois da filtragem (ou 0, se a própria aba ativa foi descartada).
pub fn load(hidden: &Path) -> Session {
    let raw = match fs::read_to_string(session_path(hidden)) {
        Ok(raw) => raw,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Session::default(),
        Err(err) => {
            eprintln!("falha ao ler a sessão: {err}");
            return Session::default();
        }
    };
    let session: Session = match serde_json::from_str(&raw) {
        Ok(session) => session,
        Err(err) => {
            eprintln!("session.json inválido, ignorando: {err}");
            return Session::default();
        }
    };

    let mut tabs = Vec::new();
    let mut active_tab_index = 0;
    for (index, tab) in session.tabs.into_iter().enumerate() {
        if !Path::new(&tab.path).is_file() {
            eprintln!("aba da sessão ignorada, arquivo não existe mais: {}", tab.path);
            continue;
        }
        if index == session.active_tab_index {
            active_tab_index = tabs.len();
        }
        tabs.push(tab);
    }
    Session { tabs, active_tab_index }
}

/// Grava a sessão de forma atômica (tmp + fsync + rename), mesmo padrão de
/// `fs_ops::save_file` — um crash no meio nunca deixa um `session.json` truncado.
pub fn save(hidden: &Path, session: &Session) -> Result<(), SessionError> {
    let target = session_path(hidden);
    let mut tmp_name = target.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".scrible-tmp");
    let tmp = target.with_file_name(tmp_name);

    let json = serde_json::to_string_pretty(session).map_err(|err| SessionError::Io(err.to_string()))?;
    let mut file = File::create(&tmp)?;
    file.write_all(json.as_bytes())?;
    file.sync_all()?;
    drop(file);
    fs::rename(&tmp, &target)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(path: &Path, cursor_pos: usize, scroll_top: f64) -> SessionTab {
        SessionTab { path: path.to_string_lossy().into_owned(), cursor_pos, scroll_top }
    }

    #[test]
    fn load_returns_empty_session_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()), Session::default());
    }

    #[test]
    fn load_returns_empty_session_when_file_is_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(SESSION_FILE), "{ nope").unwrap();
        assert_eq!(load(dir.path()), Session::default());
    }

    #[test]
    fn save_then_load_roundtrips_order_active_cursor_and_scroll() {
        let dir = tempfile::tempdir().unwrap();
        let files: Vec<PathBuf> = ["a.md", "b.md", "c.md"]
            .iter()
            .map(|name| {
                let p = dir.path().join(name);
                fs::write(&p, "x").unwrap();
                p
            })
            .collect();
        let session = Session {
            tabs: vec![tab(&files[0], 3, 10.5), tab(&files[1], 7, 0.0), tab(&files[2], 0, 120.0)],
            active_tab_index: 1,
        };
        save(dir.path(), &session).unwrap();
        assert_eq!(load(dir.path()), session);
        assert!(!dir.path().join("session.json.scrible-tmp").exists());
    }

    #[test]
    fn load_skips_missing_files_and_remaps_active_index() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let c = dir.path().join("c.md");
        fs::write(&a, "x").unwrap();
        fs::write(&c, "x").unwrap();
        let gone = dir.path().join("gone.md");
        let session = Session {
            tabs: vec![tab(&a, 0, 0.0), tab(&gone, 0, 0.0), tab(&c, 5, 0.0)],
            active_tab_index: 2,
        };
        save(dir.path(), &session).unwrap();

        let loaded = load(dir.path());
        assert_eq!(loaded.tabs.len(), 2);
        assert_eq!(loaded.tabs[1].path, c.to_string_lossy());
        assert_eq!(loaded.active_tab_index, 1);
    }

    #[test]
    fn load_falls_back_to_first_tab_when_active_file_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        fs::write(&a, "x").unwrap();
        let gone = dir.path().join("gone.md");
        let session = Session { tabs: vec![tab(&a, 0, 0.0), tab(&gone, 0, 0.0)], active_tab_index: 1 };
        save(dir.path(), &session).unwrap();

        let loaded = load(dir.path());
        assert_eq!(loaded.tabs.len(), 1);
        assert_eq!(loaded.active_tab_index, 0);
    }

    #[test]
    fn load_tolerates_missing_optional_fields() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        fs::write(&a, "x").unwrap();
        let json = format!(r#"{{"tabs":[{{"path":{:?}}}]}}"#, a.to_string_lossy());
        fs::write(dir.path().join(SESSION_FILE), json).unwrap();
        let loaded = load(dir.path());
        assert_eq!(loaded.tabs[0].cursor_pos, 0);
        assert_eq!(loaded.active_tab_index, 0);
    }
}
