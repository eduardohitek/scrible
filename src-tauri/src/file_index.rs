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

/// Preview links only accept existing files inside the canonical workspace.
/// A missing file is `NotFound`, so the frontend never creates it by opening a tab.
pub fn workspace_file(root: &Path, path: &Path) -> Result<PathBuf, FsError> {
    let root = root
        .canonicalize()
        .map_err(|err| FsError::from_io(err, root))?;
    let resolved = path
        .canonicalize()
        .map_err(|err| FsError::from_io(err, path))?;
    if !resolved.starts_with(&root) || !resolved.is_file() {
        return Err(FsError::PermissionDenied {
            path: resolved.display().to_string(),
        });
    }
    Ok(resolved)
}

/// Opening these in the default app runs code (Terminal, installers, script hosts)
/// instead of showing a document, so a click in the preview must not reach them.
const EXECUTABLE_EXTENSIONS: &[&str] = &[
    "app", "command", "tool", "terminal", "workflow", "action", "scpt", "scptd",
    "applescript", "pkg", "mpkg", "sh", "bash", "zsh", "csh", "ksh", "fish", "py", "rb",
    "pl", "php", "jar", "desktop", "appimage", "run", "exe", "com", "bat", "cmd", "msi",
    "msp", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "scr", "cpl",
    "lnk", "url", "webloc", "inetloc", "reg",
];

/// Files the preview may hand to the system opener: inside the workspace and not executable.
pub fn openable_workspace_file(root: &Path, path: &Path) -> Result<PathBuf, FsError> {
    let resolved = workspace_file(root, path)?;
    let denied = || FsError::PermissionDenied {
        path: resolved.display().to_string(),
    };
    match resolved.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if EXECUTABLE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()) => {
            return Err(denied())
        }
        // Without an extension, the system decides by the executable bit
        // (macOS opens such a file in Terminal and runs it).
        None if is_executable(&resolved) => return Err(denied()),
        _ => {}
    }
    Ok(resolved)
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .map(|meta| meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(true)
}

#[cfg(not(unix))]
fn is_executable(_path: &Path) -> bool {
    false
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
    fn missing_files_are_not_found_instead_of_being_created() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("typo.md");
        assert!(matches!(
            workspace_file(tmp.path(), &missing),
            Err(FsError::NotFound { .. })
        ));
        assert!(!missing.exists());
    }

    #[test]
    fn opener_rejects_executables_and_scripts() {
        let tmp = tempfile::tempdir().unwrap();
        for name in ["run.command", "install.PKG", "script.sh", "setup.exe", "a.js"] {
            let path = tmp.path().join(name);
            fs::write(&path, "").unwrap();
            assert!(
                openable_workspace_file(tmp.path(), &path).is_err(),
                "{name} should be rejected"
            );
        }
        for name in ["report.pdf", "photo.PNG", "notes.txt"] {
            let path = tmp.path().join(name);
            fs::write(&path, "").unwrap();
            assert!(openable_workspace_file(tmp.path(), &path).is_ok(), "{name}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn opener_rejects_extensionless_executables_only() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let plain = tmp.path().join("LICENSE");
        fs::write(&plain, "").unwrap();
        assert!(openable_workspace_file(tmp.path(), &plain).is_ok());
        let binary = tmp.path().join("tool");
        fs::write(&binary, "").unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(openable_workspace_file(tmp.path(), &binary).is_err());
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
