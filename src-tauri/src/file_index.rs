use std::fs;
use std::path::{Path, PathBuf};

use crate::fs_ops::FsError;

/// One background scan, reused by every completion query. Do not follow symlinks:
/// cycles and files outside the workspace must not enter the index.
pub fn scan(root: &Path) -> Result<Vec<String>, FsError> {
    let mut files = Vec::new();
    collect(root, root, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect(root: &Path, dir: &Path, files: &mut Vec<String>) -> Result<(), FsError> {
    let entries = fs::read_dir(dir).map_err(|err| FsError::Io {
        message: err.to_string(),
    })?;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue, // A file can disappear while the tree is being scanned.
        };
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name.ends_with(".scrible-tmp") {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() {
            // An unreadable child directory should not hide the rest of the workspace.
            if let Err(err) = collect(root, &path, files) {
                eprintln!("file_index: {}: {err}", path.display());
            }
        } else if kind.is_file() {
            if let Ok(relative) = path.strip_prefix(root) {
                files.push(
                    relative
                        .components()
                        .map(|part| part.as_os_str().to_string_lossy())
                        .collect::<Vec<_>>()
                        .join("/"),
                );
            }
        }
    }
    Ok(())
}

/// The opener only accepts existing files inside the canonical workspace.
pub fn workspace_file(root: &Path, path: &Path) -> Result<PathBuf, FsError> {
    let root = root.canonicalize().map_err(|err| FsError::Io {
        message: err.to_string(),
    })?;
    let path = path.canonicalize().map_err(|err| FsError::Io {
        message: err.to_string(),
    })?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err(FsError::PermissionDenied {
            path: path.display().to_string(),
        });
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexes_all_visible_files_recursively_without_internal_or_temporary_files() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir(tmp.path().join("images")).unwrap();
        fs::create_dir(tmp.path().join(".scrible")).unwrap();
        for name in [
            "note.md",
            "report.pdf",
            "images/photo.PNG",
            "images/foto (1).png",
            ".hidden.md",
            ".scrible/session.json",
            "note.md.scrible-tmp",
        ] {
            fs::write(tmp.path().join(name), "").unwrap();
        }
        assert_eq!(
            scan(tmp.path()).unwrap(),
            vec![
                "images/foto (1).png",
                "images/photo.PNG",
                "note.md",
                "report.pdf"
            ]
        );
    }

    #[test]
    fn indexes_hundreds_of_files() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..600 {
            fs::write(tmp.path().join(format!("{i}.md")), "").unwrap();
        }
        assert_eq!(scan(tmp.path()).unwrap().len(), 600);
    }

    #[cfg(unix)]
    #[test]
    fn skips_symlink_cycles_and_external_files() {
        let tmp = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(tmp.path(), tmp.path().join("loop")).unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::os::unix::fs::symlink(outside.path(), tmp.path().join("external.md")).unwrap();
        assert!(scan(tmp.path()).unwrap().is_empty());
        assert!(workspace_file(tmp.path(), &tmp.path().join("external.md")).is_err());
    }

    #[test]
    fn opener_rejects_outside_paths_and_directories() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        assert!(workspace_file(tmp.path(), outside.path()).is_err());
        assert!(workspace_file(tmp.path(), tmp.path()).is_err());
        let path = tmp.path().join("report.pdf");
        fs::write(&path, "").unwrap();
        assert_eq!(
            workspace_file(tmp.path(), &path).unwrap(),
            path.canonicalize().unwrap()
        );
    }
}
