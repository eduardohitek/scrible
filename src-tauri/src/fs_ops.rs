use std::fs;
use std::io::{self, Read as _};
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

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
    pub(crate) fn from_io(err: io::Error, path: &Path) -> Self {
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

/// Conteúdo e mtime de um arquivo (#143). O mtime vem do mesmo handle que foi
/// lido, então os dois descrevem a mesma versão mesmo se outro programa
/// trocar o arquivo (rename atômico) no meio da leitura.
#[derive(Debug, Serialize)]
pub struct FileWithMtime {
    pub content: String,
    pub mtime: i64,
}

pub fn read_file_with_mtime(path: &Path) -> Result<FileWithMtime, FsError> {
    let mut file = fs::File::open(path).map_err(|err| FsError::from_io(err, path))?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|err| FsError::from_io(err, path))?;
    let meta = file.metadata().map_err(|err| FsError::from_io(err, path))?;
    Ok(FileWithMtime {
        content,
        mtime: mtime_millis(&meta)?,
    })
}

/// Um arquivo de aba a conferir na checagem por foco (#143).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCheck {
    pub path: String,
    pub known_mtime: Option<i64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind")]
pub enum FileCheckResult {
    Unchanged,
    Changed { mtime: i64, content: String },
    Missing,
}

/// Compara o mtime em disco com o conhecido pela aba. O conteúdo só é lido
/// quando o mtime diverge. Erro que não seja "não existe" (ex.: permissão)
/// conta como `Unchanged`: a checagem por foco é só uma rede de segurança.
pub fn check_file(path: &Path, known_mtime: Option<i64>) -> FileCheckResult {
    match fs::metadata(path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => return FileCheckResult::Missing,
        Err(_) => return FileCheckResult::Unchanged,
        Ok(meta) => {
            if mtime_millis(&meta).ok() == known_mtime && known_mtime.is_some() {
                return FileCheckResult::Unchanged;
            }
        }
    }
    match read_file_with_mtime(path) {
        Ok(file) if Some(file.mtime) == known_mtime => FileCheckResult::Unchanged,
        Ok(file) => FileCheckResult::Changed {
            mtime: file.mtime,
            content: file.content,
        },
        Err(FsError::NotFound { .. }) => FileCheckResult::Missing,
        Err(_) => FileCheckResult::Unchanged,
    }
}

fn temp_path_for(path: &Path) -> std::path::PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".scrible-tmp");
    path.with_file_name(name)
}

pub fn save_file(path: &Path, content: &str, expected_mtime: Option<i64>) -> Result<i64, FsError> {
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
        let mut tmp_file =
            fs::File::create(&tmp_path).map_err(|err| FsError::from_io(err, &tmp_path))?;
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

/// Escrita simples, sem verificação de mtime nem escrita atômica via temp+rename
/// — ao contrário de `save_file`, este path é escolhido pelo usuário num
/// diálogo de export (#26), tipicamente fora do workspace, e não participa do
/// fluxo de autosave/conflito/histórico (sem `LastSaveMtime`, sem snapshot).
pub fn write_export_file(path: &Path, content: &str) -> Result<(), FsError> {
    fs::write(path, content).map_err(|err| FsError::from_io(err, path))
}

pub fn rename_file(from: &Path, to: &Path) -> Result<(), FsError> {
    fs::rename(from, to).map_err(|err| FsError::from_io(err, from))
}

pub fn delete_file(path: &Path) -> Result<(), FsError> {
    fs::remove_file(path).map_err(|err| FsError::from_io(err, path))
}

/// `true` se `a` e `b` são a mesma entrada no sistema de arquivos, mesmo com grafias diferentes
/// (symlink no caminho, caixa diferente num volume que não diferencia maiúsculas). Usado antes de
/// apagar o original num "mover" (#128): comparar strings apagaria o próprio destino.
pub fn same_file(a: &Path, b: &Path) -> Result<bool, FsError> {
    let meta_a = fs::metadata(a).map_err(|err| FsError::from_io(err, a))?;
    let meta_b = fs::metadata(b).map_err(|err| FsError::from_io(err, b))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(meta_a.dev() == meta_b.dev() && meta_a.ino() == meta_b.ino())
    }
    #[cfg(not(unix))]
    {
        let _ = (meta_a, meta_b);
        let canon_a = fs::canonicalize(a).map_err(|err| FsError::from_io(err, a))?;
        let canon_b = fs::canonicalize(b).map_err(|err| FsError::from_io(err, b))?;
        Ok(canon_a == canon_b)
    }
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

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

/// Lista uma pasta para o explorador (#25): pastas sempre aparecem (exceto
/// dotdirs), arquivos só se tiverem extensão `.md` — esconde `.scrible/` e
/// qualquer outro dotfile/dotdir de graça, sem checagem de nome hardcoded.
/// Ordena pastas antes de arquivos, depois alfabético case-insensitive.
pub fn list_dir_entries(path: &Path) -> Result<Vec<DirEntry>, FsError> {
    let entries = fs::read_dir(path).map_err(|err| FsError::from_io(err, path))?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|err| FsError::from_io(err, path))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry
            .file_type()
            .map_err(|err| FsError::from_io(err, path))?
            .is_dir();
        if !is_dir && !name.to_lowercase().ends_with(".md") {
            continue;
        }
        result.push(DirEntry { name, is_dir });
    }
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(result)
}

pub fn create_dir(path: &Path) -> Result<(), FsError> {
    fs::create_dir(path).map_err(|err| FsError::from_io(err, path))
}

pub fn delete_dir(path: &Path) -> Result<(), FsError> {
    fs::remove_dir_all(path).map_err(|err| FsError::from_io(err, path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn set_mtime(path: &Path, millis: u64) {
        let file = fs::File::options().write(true).open(path).unwrap();
        file.set_modified(UNIX_EPOCH + std::time::Duration::from_millis(millis))
            .unwrap();
    }

    #[test]
    fn read_file_with_mtime_returns_content_and_mtime() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("doc.md");
        fs::write(&path, "olá").unwrap();
        set_mtime(&path, 5_000);

        let file = read_file_with_mtime(&path).unwrap();

        assert_eq!(file.content, "olá");
        assert_eq!(file.mtime, 5_000);
    }

    #[test]
    fn check_file_unchanged_when_mtime_matches() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("doc.md");
        fs::write(&path, "a").unwrap();
        set_mtime(&path, 5_000);

        assert_eq!(check_file(&path, Some(5_000)), FileCheckResult::Unchanged);
    }

    #[test]
    fn check_file_changed_returns_new_content_and_mtime() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("doc.md");
        fs::write(&path, "novo").unwrap();
        set_mtime(&path, 6_000);

        assert_eq!(
            check_file(&path, Some(5_000)),
            FileCheckResult::Changed {
                mtime: 6_000,
                content: "novo".to_string()
            }
        );
        assert!(matches!(
            check_file(&path, None),
            FileCheckResult::Changed { .. }
        ));
    }

    #[test]
    fn check_file_missing_when_file_is_gone() {
        let tmp = tempfile::tempdir().unwrap();

        assert_eq!(
            check_file(&tmp.path().join("sumiu.md"), Some(5_000)),
            FileCheckResult::Missing
        );
    }

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

        let result = save_file(
            &path,
            "versão 2 (não deveria ir pro disco)",
            Some(stale_mtime),
        );

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

    #[test]
    fn list_dir_entries_hides_dotfiles_and_non_markdown() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("nota.md"), "").unwrap();
        fs::write(tmp.path().join("imagem.png"), "").unwrap();
        fs::write(tmp.path().join(".ocultosecreto.md"), "").unwrap();
        fs::create_dir(tmp.path().join(".scrible")).unwrap();
        fs::create_dir(tmp.path().join("subpasta")).unwrap();

        let entries = list_dir_entries(tmp.path()).unwrap();

        assert_eq!(
            entries,
            vec![
                DirEntry {
                    name: "subpasta".into(),
                    is_dir: true
                },
                DirEntry {
                    name: "nota.md".into(),
                    is_dir: false
                },
            ]
        );
    }

    #[test]
    fn list_dir_entries_sorts_dirs_before_files_then_alphabetically_case_insensitive() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("banana.md"), "").unwrap();
        fs::write(tmp.path().join("Abacaxi.md"), "").unwrap();
        fs::create_dir(tmp.path().join("zebra")).unwrap();
        fs::create_dir(tmp.path().join("Antilope")).unwrap();

        let entries = list_dir_entries(tmp.path()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

        assert_eq!(names, vec!["Antilope", "zebra", "Abacaxi.md", "banana.md"]);
    }

    #[test]
    fn create_dir_creates_new_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("nova-pasta");

        create_dir(&path).unwrap();

        assert!(path.is_dir());
    }

    #[test]
    fn create_dir_fails_if_already_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("pasta");
        fs::create_dir(&path).unwrap();

        let result = create_dir(&path);

        assert!(result.is_err());
    }

    #[test]
    fn delete_dir_removes_directory_and_contents() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("pasta");
        fs::create_dir(&path).unwrap();
        fs::write(path.join("arquivo.md"), "conteúdo").unwrap();

        delete_dir(&path).unwrap();

        assert!(!path.exists());
    }

    #[test]
    #[cfg(unix)]
    fn same_file_detects_symlinked_spelling_and_distinct_files() {
        let tmp = tempfile::tempdir().unwrap();
        let real_dir = tmp.path().join("real");
        fs::create_dir(&real_dir).unwrap();
        let file = real_dir.join("doc.md");
        fs::write(&file, "x").unwrap();
        let other = real_dir.join("outro.md");
        fs::write(&other, "y").unwrap();
        let link_dir = tmp.path().join("link");
        std::os::unix::fs::symlink(&real_dir, &link_dir).unwrap();

        assert!(same_file(&file, &link_dir.join("doc.md")).unwrap());
        assert!(!same_file(&file, &other).unwrap());
        assert!(same_file(&file, &tmp.path().join("missing.md")).is_err());
    }
}
