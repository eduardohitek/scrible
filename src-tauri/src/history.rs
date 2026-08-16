use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::fs_ops;

const MAX_SNAPSHOTS: usize = 20;
const THROTTLE_MS: i64 = 5 * 60 * 1000;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind")]
pub enum HistoryError {
    #[error("snapshot não encontrado: {path}")]
    NotFound { path: String },
    #[error("falha de I/O: {message}")]
    Io { message: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotInfo {
    pub timestamp: i64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RestoreResult {
    pub content: String,
    pub mtime: i64,
}

fn io_err(err: io::Error) -> HistoryError {
    HistoryError::Io {
        message: err.to_string(),
    }
}

fn now_millis() -> Result<i64, HistoryError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| HistoryError::Io {
            message: err.to_string(),
        })?;
    Ok(duration.as_millis() as i64)
}

/// FNV-1a de 64 bits, formatado em hex. Implementado à mão (em vez de
/// `DefaultHasher` do std ou de uma crate de hash) porque o algoritmo é
/// nosso e permanece estável para sempre — `DefaultHasher` não garante
/// estabilidade entre versões do Rust, o que quebraria diretórios de
/// histórico já existentes após um upgrade de toolchain.
fn hash_path(path: &Path) -> String {
    const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut hash = FNV_OFFSET_BASIS;
    for byte in path.to_string_lossy().as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{hash:016x}")
}

fn history_dir(hidden_dir: &Path, file_path: &Path) -> PathBuf {
    hidden_dir.join("history").join(hash_path(file_path))
}

/// Snapshots existentes no diretório, como `(timestamp, path)`, ordenados do
/// mais antigo pro mais recente. Diretório inexistente é uma lista vazia,
/// não um erro (ainda não há histórico pra esse arquivo).
fn snapshot_entries(dir: &Path) -> Result<Vec<(i64, PathBuf)>, HistoryError> {
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(io_err)? {
        let entry = entry.map_err(io_err)?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        if let Some(timestamp) = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .and_then(|stem| stem.parse::<i64>().ok())
        {
            entries.push((timestamp, path));
        }
    }
    entries.sort_by_key(|(timestamp, _)| *timestamp);
    Ok(entries)
}

fn latest_snapshot(dir: &Path) -> Result<Option<(i64, String)>, HistoryError> {
    let entries = snapshot_entries(dir)?;
    match entries.last() {
        None => Ok(None),
        Some((timestamp, path)) => {
            let content = fs::read_to_string(path).map_err(io_err)?;
            Ok(Some((*timestamp, content)))
        }
    }
}

fn enforce_retention(dir: &Path) -> Result<(), HistoryError> {
    let entries = snapshot_entries(dir)?;
    if entries.len() > MAX_SNAPSHOTS {
        for (_, path) in entries.iter().take(entries.len() - MAX_SNAPSHOTS) {
            fs::remove_file(path).map_err(io_err)?;
        }
    }
    Ok(())
}

/// Escreve um snapshot novo incondicionalmente (sem checar throttle nem
/// diff de conteúdo) e reforça a retenção de 20 versões.
fn write_snapshot(dir: &Path, content: &str) -> Result<(), HistoryError> {
    fs::create_dir_all(dir).map_err(io_err)?;
    let timestamp = now_millis()?;
    let path = dir.join(format!("{timestamp}.md"));
    fs::write(&path, content).map_err(io_err)?;
    enforce_retention(dir)
}

/// Chamado a cada `save_file` bem-sucedido. Só cria um snapshot novo se já
/// passaram 5 minutos desde o último E o conteúdo mudou desde então.
pub fn maybe_snapshot(hidden_dir: &Path, file_path: &Path, content: &str) -> Result<(), HistoryError> {
    let dir = history_dir(hidden_dir, file_path);

    let should_snapshot = match latest_snapshot(&dir)? {
        None => true,
        Some((timestamp, last_content)) => {
            let now = now_millis()?;
            (now - timestamp) >= THROTTLE_MS && last_content != content
        }
    };

    if should_snapshot {
        write_snapshot(&dir, content)?;
    }

    Ok(())
}

pub fn list_snapshots(hidden_dir: &Path, file_path: &Path) -> Result<Vec<SnapshotInfo>, HistoryError> {
    let dir = history_dir(hidden_dir, file_path);
    let mut entries = snapshot_entries(&dir)?;
    entries.sort_by_key(|(timestamp, _)| std::cmp::Reverse(*timestamp));

    entries
        .into_iter()
        .map(|(timestamp, path)| {
            let size = fs::metadata(&path).map_err(io_err)?.len();
            Ok(SnapshotInfo { timestamp, size })
        })
        .collect()
}

/// Restaura um snapshot: sempre tira um snapshot da versão atual (a que vai
/// ser descartada) antes de sobrescrever, ignorando o throttle — essa versão
/// não pode se perder mesmo que não tenham passado 5 minutos.
pub fn restore_snapshot(
    hidden_dir: &Path,
    file_path: &Path,
    timestamp: i64,
) -> Result<RestoreResult, HistoryError> {
    let dir = history_dir(hidden_dir, file_path);

    if let Ok(current_content) = fs::read_to_string(file_path) {
        write_snapshot(&dir, &current_content)?;
    }

    let target_path = dir.join(format!("{timestamp}.md"));
    let content = fs::read_to_string(&target_path).map_err(|err| {
        if err.kind() == io::ErrorKind::NotFound {
            HistoryError::NotFound {
                path: target_path.display().to_string(),
            }
        } else {
            io_err(err)
        }
    })?;

    let mtime = fs_ops::save_file(file_path, &content, None).map_err(|err| HistoryError::Io {
        message: err.to_string(),
    })?;

    Ok(RestoreResult { content, mtime })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIVE_MIN_MS: i64 = 5 * 60 * 1000;

    fn write_fake_snapshot(dir: &Path, timestamp: i64, content: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join(format!("{timestamp}.md")), content).unwrap();
    }

    #[test]
    fn maybe_snapshot_creates_first_snapshot_when_none_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let hidden = tmp.path().join(".scrible");
        let file_path = PathBuf::from("/docs/a.md");

        maybe_snapshot(&hidden, &file_path, "conteúdo inicial").unwrap();

        let snapshots = list_snapshots(&hidden, &file_path).unwrap();
        assert_eq!(snapshots.len(), 1);
    }

    #[test]
    fn maybe_snapshot_skips_when_last_snapshot_is_recent() {
        let tmp = tempfile::tempdir().unwrap();
        let hidden = tmp.path().join(".scrible");
        let file_path = PathBuf::from("/docs/a.md");
        let dir = history_dir(&hidden, &file_path);

        let recent = now_millis().unwrap() - 1000;
        write_fake_snapshot(&dir, recent, "versão antiga");

        maybe_snapshot(&hidden, &file_path, "versão nova").unwrap();

        let snapshots = list_snapshots(&hidden, &file_path).unwrap();
        assert_eq!(snapshots.len(), 1);
    }

    #[test]
    fn maybe_snapshot_creates_new_snapshot_after_throttle_with_changed_content() {
        let tmp = tempfile::tempdir().unwrap();
        let hidden = tmp.path().join(".scrible");
        let file_path = PathBuf::from("/docs/a.md");
        let dir = history_dir(&hidden, &file_path);

        let old = now_millis().unwrap() - FIVE_MIN_MS - 1000;
        write_fake_snapshot(&dir, old, "versão antiga");

        maybe_snapshot(&hidden, &file_path, "versão nova").unwrap();

        let snapshots = list_snapshots(&hidden, &file_path).unwrap();
        assert_eq!(snapshots.len(), 2);
    }

    #[test]
    fn maybe_snapshot_skips_when_content_unchanged_even_after_throttle() {
        let tmp = tempfile::tempdir().unwrap();
        let hidden = tmp.path().join(".scrible");
        let file_path = PathBuf::from("/docs/a.md");
        let dir = history_dir(&hidden, &file_path);

        let old = now_millis().unwrap() - FIVE_MIN_MS - 1000;
        write_fake_snapshot(&dir, old, "mesmo conteúdo");

        maybe_snapshot(&hidden, &file_path, "mesmo conteúdo").unwrap();

        let snapshots = list_snapshots(&hidden, &file_path).unwrap();
        assert_eq!(snapshots.len(), 1);
    }

    #[test]
    fn never_keeps_more_than_twenty_snapshots() {
        let tmp = tempfile::tempdir().unwrap();
        let hidden = tmp.path().join(".scrible");
        let file_path = PathBuf::from("/docs/a.md");
        let dir = history_dir(&hidden, &file_path);

        let base = now_millis().unwrap();
        for i in 0..25 {
            write_fake_snapshot(&dir, base + i, &format!("versão {i}"));
        }
        enforce_retention(&dir).unwrap();

        let snapshots = list_snapshots(&hidden, &file_path).unwrap();
        assert_eq!(snapshots.len(), 20);
        // As 20 mais recentes devem ter sobrevivido (maiores timestamps).
        assert!(snapshots.iter().all(|s| s.timestamp >= base + 5));
    }

    #[test]
    fn restore_snapshot_overwrites_file_and_snapshots_discarded_version() {
        let tmp = tempfile::tempdir().unwrap();
        let hidden = tmp.path().join(".scrible");
        let file_path = tmp.path().join("doc.md");
        fs::write(&file_path, "versão descartada").unwrap();

        let dir = history_dir(&hidden, &file_path);
        let target_ts = now_millis().unwrap() - FIVE_MIN_MS;
        write_fake_snapshot(&dir, target_ts, "versão antiga restaurada");

        let result = restore_snapshot(&hidden, &file_path, target_ts).unwrap();

        assert_eq!(result.content, "versão antiga restaurada");
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "versão antiga restaurada");

        let snapshots = list_snapshots(&hidden, &file_path).unwrap();
        // A versão descartada foi preservada como um snapshot novo.
        assert_eq!(snapshots.len(), 2);
    }

    #[test]
    fn restore_snapshot_returns_not_found_for_missing_timestamp() {
        let tmp = tempfile::tempdir().unwrap();
        let hidden = tmp.path().join(".scrible");
        let file_path = tmp.path().join("doc.md");
        fs::write(&file_path, "conteúdo atual").unwrap();

        let result = restore_snapshot(&hidden, &file_path, 123456789);

        assert!(matches!(result, Err(HistoryError::NotFound { .. })));
    }

    #[test]
    fn list_snapshots_returns_empty_when_no_history_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let hidden = tmp.path().join(".scrible");
        let file_path = PathBuf::from("/docs/never-saved.md");

        let snapshots = list_snapshots(&hidden, &file_path).unwrap();

        assert!(snapshots.is_empty());
    }
}
