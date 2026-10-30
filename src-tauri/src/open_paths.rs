use std::path::Path;
use std::sync::Mutex;

const MARKDOWN_EXTENSIONS: [&str; 2] = ["md", "markdown"];

/// Paths vindos de fora do processo (SO, linha de comando, segunda instância)
/// só são aceitos se forem um arquivo regular existente com extensão
/// `.md`/`.markdown` — revisita a ressalva da #6 (ver DECISIONS.md #102).
/// Os rejeitados são descartados com aviso no log; a ordem dos aceitos é
/// preservada (o último vira a aba ativa no frontend).
pub fn validate(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|path| {
            let ok = is_openable_markdown(Path::new(path));
            if !ok {
                eprintln!("path externo rejeitado (não é um .md/.markdown existente): {path}");
            }
            ok
        })
        .collect()
}

fn is_openable_markdown(path: &Path) -> bool {
    let has_markdown_ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| MARKDOWN_EXTENSIONS.iter().any(|md| ext.eq_ignore_ascii_case(md)));
    has_markdown_ext && path.metadata().is_ok_and(|meta| meta.is_file())
}

/// Paths entregues pelo SO antes de o frontend estar pronto para recebê-los
/// por evento. O frontend os consome uma única vez no boot, depois de
/// restaurar a sessão (`take_pending_open_paths`).
#[derive(Default)]
pub struct PendingOpenPaths(Mutex<Vec<String>>);

impl PendingOpenPaths {
    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn path_str(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn accepts_existing_md_and_markdown_files() {
        let dir = tempfile::tempdir().unwrap();
        let md = dir.path().join("nota.md");
        let markdown = dir.path().join("outra.MARKDOWN");
        fs::write(&md, "# a").unwrap();
        fs::write(&markdown, "# b").unwrap();

        let paths = vec![path_str(&md), path_str(&markdown)];
        assert_eq!(validate(paths.clone()), paths);
    }

    #[test]
    fn rejects_directory_wrong_extension_and_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("pasta.md");
        fs::create_dir(&folder).unwrap();
        let txt = dir.path().join("nota.txt");
        fs::write(&txt, "x").unwrap();
        let no_ext = dir.path().join("README");
        fs::write(&no_ext, "x").unwrap();
        let missing = dir.path().join("sumiu.md");
        let valid = dir.path().join("ok.md");
        fs::write(&valid, "x").unwrap();

        let result = validate(vec![
            path_str(&folder),
            path_str(&txt),
            path_str(&no_ext),
            path_str(&missing),
            path_str(&valid),
        ]);
        assert_eq!(result, vec![path_str(&valid)]);
    }

    #[test]
    fn take_drains_the_queue() {
        let pending = PendingOpenPaths::default();
        pending.0.lock().unwrap().push("/a.md".into());
        assert_eq!(pending.take(), vec!["/a.md".to_string()]);
        assert!(pending.take().is_empty());
    }
}
