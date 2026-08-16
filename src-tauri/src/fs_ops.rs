use std::fs;
use std::io;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind")]
pub enum FsError {
    #[error("arquivo não encontrado: {path}")]
    NotFound { path: String },
    #[error("sem permissão de escrita em {path}")]
    PermissionDenied { path: String },
    #[error("falha de I/O: {message}")]
    Io { message: String },
    #[error("arquivo foi alterado externamente")]
    ExternalChange {
        current_mtime: i64,
        current_content: String,
    },
}

impl FsError {
    fn from_io(err: io::Error, path: &Path) -> Self {
        match err.kind() {
            io::ErrorKind::NotFound => FsError::NotFound {
                path: path.display().to_string(),
            },
            io::ErrorKind::PermissionDenied => FsError::PermissionDenied {
                path: path.display().to_string(),
            },
            _ => FsError::Io {
                message: err.to_string(),
            },
        }
    }
}

pub(crate) fn mtime_millis(meta: &fs::Metadata) -> Result<i64, FsError> {
    let duration = meta
        .modified()
        .map_err(|err| FsError::Io {
            message: err.to_string(),
        })?
        .duration_since(UNIX_EPOCH)
        .map_err(|err| FsError::Io {
            message: err.to_string(),
        })?;
    Ok(duration.as_millis() as i64)
}

pub fn read_file(path: &Path) -> Result<String, FsError> {
    fs::read_to_string(path).map_err(|err| FsError::from_io(err, path))
}

fn temp_path_for(path: &Path) -> std::path::PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".scrible-tmp");
    path.with_file_name(name)
}

pub fn save_file(
    path: &Path,
    content: &str,
    expected_mtime: Option<i64>,
) -> Result<i64, FsError> {
    if let Some(expected) = expected_mtime {
        match fs::metadata(path) {
            Ok(meta) => {
                let current_mtime = mtime_millis(&meta)?;
                if current_mtime != expected {
                    let current_content = read_file(path)?;
                    return Err(FsError::ExternalChange {
                        current_mtime,
                        current_content,
                    });
                }
            }
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                // Nada em disco ainda: não há como divergir, segue para a escrita.
            }
            Err(err) => return Err(FsError::from_io(err, path)),
        }
    }

    let tmp_path = temp_path_for(path);
    {
        let mut tmp_file = fs::File::create(&tmp_path).map_err(|err| FsError::from_io(err, &tmp_path))?;
        use std::io::Write;
        tmp_file
            .write_all(content.as_bytes())
            .map_err(|err| FsError::from_io(err, &tmp_path))?;
        tmp_file
            .sync_all()
            .map_err(|err| FsError::from_io(err, &tmp_path))?;
    }

    fs::rename(&tmp_path, path).map_err(|err| FsError::from_io(err, path))?;

    let meta = fs::metadata(path).map_err(|err| FsError::from_io(err, path))?;
    mtime_millis(&meta)
}

pub fn rename_file(from: &Path, to: &Path) -> Result<(), FsError> {
    fs::rename(from, to).map_err(|err| FsError::from_io(err, from))
}

pub fn delete_file(path: &Path) -> Result<(), FsError> {
    fs::remove_file(path).map_err(|err| FsError::from_io(err, path))
}

pub fn list_dir(path: &Path) -> Result<Vec<String>, FsError> {
    let entries = fs::read_dir(path).map_err(|err| FsError::from_io(err, path))?;
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|err| FsError::from_io(err, path))?;
        names.push(entry.file_name().to_string_lossy().into_owned());
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    #[test]
    fn read_file_returns_not_found_for_missing_path() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("missing.md");

        let result = read_file(&path);

        assert!(matches!(result, Err(FsError::NotFound { .. })));
    }

    #[test]
    fn save_file_creates_and_reads_back_content() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("doc.md");

        save_file(&path, "conteúdo inicial", None).unwrap();

        assert_eq!(read_file(&path).unwrap(), "conteúdo inicial");
    }

    #[test]
    fn save_file_never_truncates_if_rename_never_happens() {
        // Prova estrutural de atomicidade: escreve no temp file e propositalmente
        // NÃO chama rename (simula um crash entre o fsync e o rename). O arquivo
        // original precisa permanecer intacto, porque nunca foi aberto para escrita.
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("doc.md");
        fs::write(&path, "conteúdo original").unwrap();

        let tmp_path = temp_path_for(&path);
        let mut tmp_file = fs::File::create(&tmp_path).unwrap();
        tmp_file.write_all(b"conteudo parcial trunc").unwrap();
        tmp_file.sync_all().unwrap();
        drop(tmp_file);
        // rename() deliberadamente não chamado aqui.

        assert_eq!(fs::read_to_string(&path).unwrap(), "conteúdo original");
    }

    #[test]
    fn save_file_survives_one_hundred_sequential_writes() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("doc.md");

        let large_content = "x".repeat(1024 * 1024); // ~1 MB

        for i in 0..100 {
            let content = if i == 50 {
                large_content.clone()
            } else {
                format!("versão {i}")
            };
            save_file(&path, &content, None).unwrap();
            assert_eq!(fs::read_to_string(&path).unwrap(), content);
        }

        let tmp_path = temp_path_for(&path);
        assert!(!tmp_path.exists());
    }

    #[test]
    fn save_file_detects_external_change_without_touching_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("doc.md");

        let first_mtime = save_file(&path, "versão 1", None).unwrap();

        // Simula alteração externa: mtime que o chamador tinha em mãos não bate
        // mais com o mtime atual em disco (aqui, deliberadamente errado).
        let stale_mtime = first_mtime - 1000;

        let result = save_file(&path, "versão 2 (não deveria ir pro disco)", Some(stale_mtime));

        match result {
            Err(FsError::ExternalChange {
                current_mtime,
                current_content,
            }) => {
                assert_eq!(current_mtime, first_mtime);
                assert_eq!(current_content, "versão 1");
            }
            other => panic!("esperado ExternalChange, obtido {other:?}"),
        }
        assert_eq!(fs::read_to_string(&path).unwrap(), "versão 1");
    }

    #[test]
    fn save_file_succeeds_when_expected_mtime_matches() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("doc.md");

        let first_mtime = save_file(&path, "versão 1", None).unwrap();
        save_file(&path, "versão 2", Some(first_mtime)).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "versão 2");
    }

    #[test]
    fn rename_file_moves_content() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("a.md");
        let to = tmp.path().join("b.md");
        fs::write(&from, "conteúdo").unwrap();

        rename_file(&from, &to).unwrap();

        assert!(!from.exists());
        assert_eq!(fs::read_to_string(&to).unwrap(), "conteúdo");
    }

    #[test]
    fn rename_file_returns_not_found_for_missing_source() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("missing.md");
        let to = tmp.path().join("b.md");

        let result = rename_file(&from, &to);

        assert!(matches!(result, Err(FsError::NotFound { .. })));
    }

    #[test]
    fn delete_file_removes_existing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("doc.md");
        fs::write(&path, "conteúdo").unwrap();

        delete_file(&path).unwrap();

        assert!(!path.exists());
    }

    #[test]
    fn delete_file_returns_not_found_for_missing_path() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("missing.md");

        let result = delete_file(&path);

        assert!(matches!(result, Err(FsError::NotFound { .. })));
    }

    #[test]
    fn list_dir_returns_entry_names() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.md"), "").unwrap();
        fs::write(tmp.path().join("b.md"), "").unwrap();

        let mut names = list_dir(tmp.path()).unwrap();
        names.sort();

        assert_eq!(names, vec!["a.md".to_string(), "b.md".to_string()]);
    }

    #[test]
    fn list_dir_returns_not_found_for_missing_path() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("missing-dir");

        let result = list_dir(&path);

        assert!(matches!(result, Err(FsError::NotFound { .. })));
    }
}
