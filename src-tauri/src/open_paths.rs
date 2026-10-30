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

/// Converte as URLs entregues pelo SO (`RunEvent::Opened`, macOS) em paths.
/// URLs que não são `file://` são ignoradas.
#[cfg(any(target_os = "macos", test))]
pub fn file_urls_to_paths(urls: &[tauri::Url]) -> Vec<String> {
    urls.iter()
        .filter(|url| url.scheme() == "file")
        .filter_map(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Paths entregues pelo SO antes de o frontend estar pronto para recebê-los
/// por evento. O frontend os consome uma única vez no boot, depois de
/// restaurar a sessão (`take_pending_open_paths`); a partir daí os próximos
/// vão direto pelo evento `open-paths`.
#[derive(Default)]
pub struct PendingOpenPaths(Mutex<Pending>);

#[derive(Default)]
struct Pending {
    paths: Vec<String>,
    frontend_ready: bool,
}

impl PendingOpenPaths {
    /// Devolve a fila e marca o frontend como pronto.
    pub fn take(&self) -> Vec<String> {
        let mut pending = self.0.lock().unwrap();
        pending.frontend_ready = true;
        std::mem::take(&mut pending.paths)
    }

    /// Enfileira enquanto o frontend não consumiu a fila; depois disso devolve
    /// os paths para o chamador emitir. Checar e enfileirar sob o mesmo lock
    /// evita perder paths que cheguem durante o `take`.
    #[cfg(any(target_os = "macos", test))]
    pub fn enqueue_unless_ready(&self, paths: Vec<String>) -> Option<Vec<String>> {
        let mut pending = self.0.lock().unwrap();
        if pending.frontend_ready {
            return Some(paths);
        }
        pending.paths.extend(paths);
        None
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
        assert_eq!(pending.enqueue_unless_ready(vec!["/a.md".into()]), None);
        assert_eq!(pending.enqueue_unless_ready(vec!["/b.md".into()]), None);
        assert_eq!(pending.take(), vec!["/a.md".to_string(), "/b.md".to_string()]);
        assert!(pending.take().is_empty());
    }

    #[test]
    fn paths_after_take_are_returned_for_emission() {
        let pending = PendingOpenPaths::default();
        pending.take();
        assert_eq!(pending.enqueue_unless_ready(vec!["/a.md".into()]), Some(vec!["/a.md".to_string()]));
        assert!(pending.take().is_empty());
    }

    fn url(raw: &str) -> tauri::Url {
        tauri::Url::parse(raw).unwrap()
    }

    // Paths POSIX: no Windows `to_file_path` exige letra de drive.
    #[cfg(unix)]
    #[test]
    fn converts_percent_encoded_file_urls() {
        let urls = [url("file:///Users/eu/Minhas%20Notas/ca%C3%A7%C3%A3o.md")];
        assert_eq!(file_urls_to_paths(&urls), vec!["/Users/eu/Minhas Notas/cação.md".to_string()]);
    }

    #[cfg(unix)]
    #[test]
    fn ignores_non_file_urls_and_keeps_order() {
        let urls = [
            url("file:///tmp/a.md"),
            url("https://example.com/b.md"),
            url("scrible://abrir"),
            url("file:///tmp/c.markdown"),
        ];
        assert_eq!(file_urls_to_paths(&urls), vec!["/tmp/a.md".to_string(), "/tmp/c.markdown".to_string()]);
    }
}
