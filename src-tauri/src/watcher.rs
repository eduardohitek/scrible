use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;

use crate::fs_ops;

const DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ExternalChangePayload {
    /// O path exatamente como o frontend o mandou em `set_watched_paths` —
    /// o roteamento para as abas é por igualdade de string.
    pub path: String,
    pub mtime: i64,
    pub content: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ExternalRemovalPayload {
    pub path: String,
}

/// O que o watcher entrega a cada rajada assentada (#140, #141).
#[derive(Debug, PartialEq)]
pub enum WatchEvent {
    Changed(ExternalChangePayload),
    /// O arquivo existia e deixou de existir (apagado, renomeado ou movido
    /// por fora). Emitido uma vez por transição; quando ele volta, sai como
    /// `Changed`.
    Removed(ExternalRemovalPayload),
}

fn disk_mtime(path: &Path) -> Option<i64> {
    let meta = fs::metadata(path).ok()?;
    fs_ops::mtime_millis(&meta).ok()
}

/// Diretórios pais dos arquivos observados, sem repetição: cada pasta ganha
/// um único watch, compartilhado por todos os arquivos abertos dela.
fn parent_dirs<'a>(paths: impl IntoIterator<Item = &'a String>) -> HashSet<PathBuf> {
    paths
        .into_iter()
        .filter_map(|path| Path::new(path).parent())
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .collect()
}

/// Arquivos observados e o último mtime conhecido de cada um. "Conhecido" é
/// o que o scrible já viu: o save do próprio app (supressão de eco), o mtime
/// em disco quando o arquivo entrou no conjunto (baseline) ou uma alteração
/// externa já emitida. Um evento só vira alteração externa quando o mtime em
/// disco diverge desse valor — sem pausar o watcher por janela de tempo.
#[derive(Default)]
struct WatchSet {
    files: HashMap<String, Option<i64>>,
}

impl WatchSet {
    /// Substitui o conjunto inteiro. Paths que já estavam mantêm o mtime
    /// conhecido (uma alteração ainda não vista continua sendo detectada);
    /// paths novos tomam o mtime atual em disco como baseline, então abrir
    /// ou renomear uma aba não gera evento.
    fn replace(&mut self, paths: Vec<String>) {
        let mut next = HashMap::with_capacity(paths.len());
        for path in paths {
            let known = match self.files.get(&path) {
                Some(known) => *known,
                None => disk_mtime(Path::new(&path)),
            };
            next.insert(path, known);
        }
        self.files = next;
    }

    fn record_save(&mut self, path: &str, mtime: i64) {
        self.record_known(path, Some(mtime));
    }

    /// Marca um estado de disco como já visto (`None` = arquivo ausente).
    fn record_known(&mut self, path: &str, mtime: Option<i64>) {
        if let Some(known) = self.files.get_mut(path) {
            *known = mtime;
        }
    }

    /// Alterações externas desde a última checagem, já marcadas como vistas.
    /// Arquivo que sumiu vira `Removed` (conhecido passa a `None`, então não
    /// repete); arquivo ilegível é pulado sem mexer no conhecido. Como a
    /// checagem só roda depois de a rajada assentar, o rename atômico de outro
    /// editor (o arquivo some e volta dentro do debounce) sai como `Changed`.
    fn collect_changes(&mut self) -> Vec<WatchEvent> {
        let mut changes = Vec::new();
        for (path, known) in self.files.iter_mut() {
            let Some(mtime) = disk_mtime(Path::new(path)) else {
                if known.take().is_some() {
                    changes.push(WatchEvent::Removed(ExternalRemovalPayload {
                        path: path.clone(),
                    }));
                }
                continue;
            };
            if *known == Some(mtime) {
                continue;
            }
            let Ok(content) = fs::read_to_string(path) else {
                continue;
            };
            *known = Some(mtime);
            changes.push(WatchEvent::Changed(ExternalChangePayload {
                path: path.clone(),
                mtime,
                content,
            }));
        }
        changes
    }
}

struct Inner {
    set: WatchSet,
    watcher: Option<RecommendedWatcher>,
    /// Diretórios com watch ativo de fato (falhas ficam de fora e são
    /// tentadas de novo no próximo `set_paths`).
    dirs: HashSet<PathBuf>,
}

/// Watcher de alteração externa dos arquivos abertos em abas (#10, #140).
/// Observa o **diretório pai** de cada arquivo, não o arquivo: sobrevive ao
/// rename atômico que outros programas (e o próprio scrible) fazem ao salvar.
/// `NonRecursive` restringe os eventos aos filhos diretos, então escritas em
/// `.scrible/history/` não geram ruído.
#[derive(Clone)]
pub struct FileWatcher(Arc<Mutex<Inner>>);

impl FileWatcher {
    /// Cria o watcher e a thread que, a cada rajada de eventos assentada,
    /// confere todos os arquivos observados e chama `on_change` para cada
    /// alteração ou remoção externa. Sem watcher nativo disponível, o conjunto continua
    /// sendo mantido, só não há eventos.
    pub fn start(on_change: impl Fn(WatchEvent) + Send + 'static) -> Self {
        let (tx, rx) = mpsc::channel();
        let watcher = match notify::recommended_watcher(tx) {
            Ok(watcher) => Some(watcher),
            Err(err) => {
                eprintln!("watcher: falha ao criar: {err}");
                None
            }
        };
        let this = FileWatcher(Arc::new(Mutex::new(Inner {
            set: WatchSet::default(),
            watcher,
            dirs: HashSet::new(),
        })));

        let inner = Arc::clone(&this.0);
        std::thread::spawn(move || {
            while wait_for_settled_event(&rx, DEBOUNCE) {
                let changes = inner.lock().unwrap().set.collect_changes();
                for change in changes {
                    on_change(change);
                }
            }
        });

        this
    }

    /// Substitui o conjunto de arquivos observados (a lista completa de paths
    /// abertos em abas) e ajusta os watches de diretório.
    pub fn set_paths(&self, paths: Vec<String>) {
        let mut guard = self.0.lock().unwrap();
        let inner = &mut *guard;
        inner.set.replace(paths);
        let wanted = parent_dirs(inner.set.files.keys());
        let Some(watcher) = inner.watcher.as_mut() else {
            return;
        };

        for dir in inner.dirs.difference(&wanted).cloned().collect::<Vec<_>>() {
            let _ = watcher.unwatch(&dir);
            inner.dirs.remove(&dir);
        }
        for dir in wanted {
            if inner.dirs.contains(&dir) {
                continue;
            }
            match watcher.watch(&dir, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    inner.dirs.insert(dir);
                }
                Err(err) => eprintln!("watcher: falha ao observar {}: {err}", dir.display()),
            }
        }
    }

    /// Registra o mtime de uma escrita do próprio scrible, para o evento
    /// dela não voltar como alteração externa.
    pub fn record_save(&self, path: &str, mtime: i64) {
        self.0.lock().unwrap().set.record_save(path, mtime);
    }

    /// Registra o que a checagem por foco (#143) já entregou ao frontend
    /// (`None` = arquivo ausente), para a próxima rajada não reemitir a mesma
    /// alteração ou remoção.
    pub fn record_known(&self, path: &str, mtime: Option<i64>) {
        self.0.lock().unwrap().set.record_known(path, mtime);
    }
}

/// Bloqueia até o primeiro evento chegar, depois drena qualquer rajada de
/// eventos subsequentes (ex: escrita atômica via temp+rename gera múltiplos
/// eventos por escrita lógica) dentro da janela de debounce, retornando só
/// quando o canal "assenta" (silêncio contínuo por `debounce`).
///
/// Retorna `false` quando o canal fecha (o `Watcher` foi dropado) — sinal
/// pro loop chamador encerrar a thread.
fn wait_for_settled_event(rx: &mpsc::Receiver<notify::Result<Event>>, debounce: Duration) -> bool {
    if rx.recv().is_err() {
        return false;
    }
    loop {
        match rx.recv_timeout(debounce) {
            Ok(_) => continue,
            Err(RecvTimeoutError::Timeout) => return true,
            Err(RecvTimeoutError::Disconnected) => return false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn changed_paths(events: Vec<WatchEvent>) -> Vec<String> {
        events
            .into_iter()
            .map(|event| match event {
                WatchEvent::Changed(change) => change.path,
                WatchEvent::Removed(removal) => panic!("remoção inesperada: {}", removal.path),
            })
            .collect()
    }

    fn path_string(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    /// Grava `content` e fixa o mtime em `millis`, para não depender da
    /// granularidade do relógio entre escritas seguidas.
    fn write_with_mtime(path: &Path, content: &str, millis: u64) {
        fs::write(path, content).unwrap();
        let file = fs::File::options().write(true).open(path).unwrap();
        file.set_modified(UNIX_EPOCH + Duration::from_millis(millis))
            .unwrap();
    }

    #[test]
    fn parent_dirs_dedups_files_of_the_same_folder() {
        let paths = vec![
            "/a/x.md".to_string(),
            "/a/y.md".to_string(),
            "/b/z.md".to_string(),
        ];

        let dirs = parent_dirs(&paths);

        assert_eq!(
            dirs,
            HashSet::from([PathBuf::from("/a"), PathBuf::from("/b")])
        );
    }

    #[test]
    fn new_path_takes_disk_mtime_as_baseline() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        write_with_mtime(&file, "um", 1_000_000);
        let mut set = WatchSet::default();

        set.replace(vec![path_string(&file)]);

        assert!(set.collect_changes().is_empty());
    }

    #[test]
    fn reports_external_change_once_with_path_and_content() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        write_with_mtime(&file, "um", 1_000_000);
        let mut set = WatchSet::default();
        set.replace(vec![path_string(&file)]);

        write_with_mtime(&file, "dois", 2_000_000);

        assert_eq!(
            set.collect_changes(),
            vec![WatchEvent::Changed(ExternalChangePayload {
                path: path_string(&file),
                mtime: 2_000_000,
                content: "dois".to_string(),
            })]
        );
        assert!(set.collect_changes().is_empty());
    }

    #[test]
    fn own_save_is_suppressed_only_for_the_saved_path() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        write_with_mtime(&a, "a", 1_000_000);
        write_with_mtime(&b, "b", 1_000_000);
        let mut set = WatchSet::default();
        set.replace(vec![path_string(&a), path_string(&b)]);

        write_with_mtime(&a, "a salvo pelo scrible", 2_000_000);
        set.record_save(&path_string(&a), 2_000_000);
        write_with_mtime(&b, "b alterado por fora", 2_000_000);

        assert_eq!(changed_paths(set.collect_changes()), vec![path_string(&b)]);
    }

    #[test]
    fn path_kept_across_replace_keeps_pending_change() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        write_with_mtime(&a, "a", 1_000_000);
        write_with_mtime(&b, "b", 1_000_000);
        let mut set = WatchSet::default();
        set.replace(vec![path_string(&a)]);

        write_with_mtime(&a, "a novo", 2_000_000);
        set.replace(vec![path_string(&a), path_string(&b)]);

        assert_eq!(changed_paths(set.collect_changes()), vec![path_string(&a)]);
    }

    #[test]
    fn removed_file_is_reported_once_and_as_change_when_it_comes_back() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        write_with_mtime(&file, "um", 1_000_000);
        let mut set = WatchSet::default();
        set.replace(vec![path_string(&file)]);

        fs::remove_file(&file).unwrap();
        assert_eq!(
            set.collect_changes(),
            vec![WatchEvent::Removed(ExternalRemovalPayload {
                path: path_string(&file)
            })]
        );
        assert!(set.collect_changes().is_empty());

        write_with_mtime(&file, "de volta", 3_000_000);
        assert_eq!(
            set.collect_changes(),
            vec![WatchEvent::Changed(ExternalChangePayload {
                path: path_string(&file),
                mtime: 3_000_000,
                content: "de volta".to_string(),
            })]
        );
    }

    #[test]
    fn path_missing_at_baseline_is_not_reported_as_removed() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nunca-existiu.md");
        let mut set = WatchSet::default();

        set.replace(vec![path_string(&file)]);

        assert!(set.collect_changes().is_empty());
    }

    #[test]
    fn atomic_replace_between_checks_is_a_change_not_a_removal() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        let tmp = dir.path().join("a.md.tmp");
        write_with_mtime(&file, "um", 1_000_000);
        let mut set = WatchSet::default();
        set.replace(vec![path_string(&file)]);

        fs::remove_file(&file).unwrap();
        write_with_mtime(&tmp, "dois", 2_000_000);
        fs::rename(&tmp, &file).unwrap();

        assert_eq!(
            changed_paths(set.collect_changes()),
            vec![path_string(&file)]
        );
    }

    #[test]
    fn removed_path_is_no_longer_checked() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        write_with_mtime(&file, "um", 1_000_000);
        let mut set = WatchSet::default();
        set.replace(vec![path_string(&file)]);

        set.replace(vec![]);
        write_with_mtime(&file, "dois", 2_000_000);

        assert!(set.collect_changes().is_empty());
    }

    #[test]
    fn file_watcher_emits_only_for_watched_files() {
        let dir = tempfile::tempdir().unwrap();
        let watched = dir.path().join("aberto.md");
        let other = dir.path().join("fechado.md");
        write_with_mtime(&watched, "um", 1_000_000);
        write_with_mtime(&other, "um", 1_000_000);

        let (tx, rx) = mpsc::channel();
        let watcher = FileWatcher::start(move |change| {
            let _ = tx.send(change);
        });
        watcher.set_paths(vec![path_string(&watched)]);
        // FSEvents só entrega eventos a partir de quando o stream começa.
        std::thread::sleep(Duration::from_millis(200));

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        write_with_mtime(&other, "alterado", now);
        write_with_mtime(&watched, "alterado por fora", now);

        let change = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("evento do arquivo observado");
        assert_eq!(
            change,
            WatchEvent::Changed(ExternalChangePayload {
                path: path_string(&watched),
                mtime: now as i64,
                content: "alterado por fora".to_string(),
            })
        );
        assert!(rx.recv_timeout(Duration::from_millis(800)).is_err());

        fs::remove_file(&other).unwrap();
        fs::remove_file(&watched).unwrap();
        let removal = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("remoção do arquivo observado");
        assert_eq!(
            removal,
            WatchEvent::Removed(ExternalRemovalPayload {
                path: path_string(&watched)
            })
        );
        assert!(rx.recv_timeout(Duration::from_millis(800)).is_err());
    }

    #[test]
    fn wait_for_settled_event_returns_false_when_channel_closes() {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        drop(tx);

        assert!(!wait_for_settled_event(&rx, Duration::from_millis(20)));
    }

    #[test]
    fn wait_for_settled_event_coalesces_a_burst_into_one_settle() {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        // `tx` (o original) fica vivo até o fim do teste — só o clone viaja
        // pra thread da rajada. Isso simula o `Watcher` real, cujo sender
        // interno só desconecta quando o `Watcher` inteiro é dropado (não a
        // cada rajada de eventos individual).
        let burst_tx = tx.clone();

        std::thread::spawn(move || {
            for _ in 0..5 {
                let _ = burst_tx.send(Ok(Event::default()));
                std::thread::sleep(Duration::from_millis(5));
            }
        });

        // Uma rajada de 5 eventos, ~5ms entre cada, deve assentar como um
        // único settle sob um debounce de 100ms (bem maior que o intervalo
        // entre eventos da rajada).
        assert!(wait_for_settled_event(&rx, Duration::from_millis(100)));
        // Depois de assentado, não deve sobrar nenhum evento da rajada no
        // canal pra um segundo settle indevido.
        assert!(rx.try_recv().is_err());
    }
}
