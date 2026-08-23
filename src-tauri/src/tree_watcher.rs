use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use notify::{Event, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

const DEBOUNCE: Duration = Duration::from_millis(300);

/// `true` quando o evento bruto do `notify` tem pelo menos um path fora de
/// `hidden_dir` — eventos só dentro de `.scrible/` (autosave de
/// settings.json, snapshots de histórico) não interessam ao explorador e não
/// devem disparar um refresh da árvore.
fn touches_visible_tree(event: &Event, hidden_dir: &Path) -> bool {
    event.paths.iter().any(|path| !path.starts_with(hidden_dir))
}

/// Bloqueia até o primeiro evento chegar, drena qualquer rajada subsequente
/// dentro da janela de debounce (mesma ideia de `watcher::wait_for_settled_event`,
/// mas aqui também precisamos inspecionar o path de cada evento pra decidir
/// se vale a pena emitir um refresh — por isso não reaproveita aquela função,
/// que descarta o conteúdo dos eventos ao drenar o canal).
///
/// Retorna `None` quando o canal fecha (watcher dropado, thread deve
/// encerrar). Retorna `Some(relevant)` quando a rajada assenta, indicando se
/// algum evento da rajada tocou algo fora de `.scrible/`.
fn wait_for_settled_relevant_event(
    rx: &mpsc::Receiver<notify::Result<Event>>,
    debounce: Duration,
    hidden_dir: &Path,
) -> Option<bool> {
    let first = rx.recv().ok()?;
    let mut relevant = first.map(|e| touches_visible_tree(&e, hidden_dir)).unwrap_or(true);

    loop {
        match rx.recv_timeout(debounce) {
            Ok(result) => {
                if !relevant {
                    relevant = result.map(|e| touches_visible_tree(&e, hidden_dir)).unwrap_or(true);
                }
            }
            Err(RecvTimeoutError::Timeout) => return Some(relevant),
            Err(RecvTimeoutError::Disconnected) => return None,
        }
    }
}

/// Observa a raiz do workspace de forma recursiva, dedicado ao explorador de
/// arquivos (#25) — separado do watcher de reconciliação de conflito
/// (`watcher.rs`), que continua restrito a um único path fixo. Sem
/// supressão de eco por mtime: uma re-busca redundante da árvore após uma
/// escrita do próprio scrible é inofensiva (ao contrário do watcher de
/// conflito, aqui não há risco de mostrar um banner de conflito indevido).
pub fn start_watching(app: AppHandle, workspace_root: PathBuf, hidden_dir: PathBuf) {
    std::thread::spawn(move || {
        let (tx, rx) = mpsc::channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(watcher) => watcher,
            Err(err) => {
                eprintln!("tree_watcher: falha ao criar: {err}");
                return;
            }
        };

        if let Err(err) = watcher.watch(&workspace_root, RecursiveMode::Recursive) {
            eprintln!("tree_watcher: falha ao observar {}: {err}", workspace_root.display());
            return;
        }

        loop {
            match wait_for_settled_relevant_event(&rx, DEBOUNCE, &hidden_dir) {
                Some(true) => {
                    let _ = app.emit("workspace-tree-changed", ());
                }
                Some(false) => continue,
                None => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, EventKind};

    fn event_for(path: &str) -> Event {
        Event::new(EventKind::Create(CreateKind::File)).add_path(PathBuf::from(path))
    }

    #[test]
    fn touches_visible_tree_true_for_path_outside_hidden_dir() {
        let hidden = PathBuf::from("/root/.scrible");
        assert!(touches_visible_tree(&event_for("/root/nota.md"), &hidden));
    }

    #[test]
    fn touches_visible_tree_false_for_path_inside_hidden_dir() {
        let hidden = PathBuf::from("/root/.scrible");
        assert!(!touches_visible_tree(&event_for("/root/.scrible/settings.json"), &hidden));
    }

    #[test]
    fn wait_for_settled_relevant_event_returns_none_when_channel_closes() {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        drop(tx);

        let hidden = PathBuf::from("/root/.scrible");
        assert_eq!(wait_for_settled_relevant_event(&rx, Duration::from_millis(20), &hidden), None);
    }

    #[test]
    fn wait_for_settled_relevant_event_true_when_burst_has_visible_change() {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let burst_tx = tx.clone();
        std::thread::spawn(move || {
            let _ = burst_tx.send(Ok(event_for("/root/.scrible/settings.json")));
            std::thread::sleep(Duration::from_millis(5));
            let _ = burst_tx.send(Ok(event_for("/root/nota.md")));
        });

        let hidden = PathBuf::from("/root/.scrible");
        assert_eq!(
            wait_for_settled_relevant_event(&rx, Duration::from_millis(100), &hidden),
            Some(true)
        );
    }

    #[test]
    fn wait_for_settled_relevant_event_false_when_burst_only_touches_hidden_dir() {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let burst_tx = tx.clone();
        std::thread::spawn(move || {
            let _ = burst_tx.send(Ok(event_for("/root/.scrible/settings.json")));
            std::thread::sleep(Duration::from_millis(5));
            let _ = burst_tx.send(Ok(event_for("/root/.scrible/history/abc/1.md")));
        });

        let hidden = PathBuf::from("/root/.scrible");
        assert_eq!(
            wait_for_settled_relevant_event(&rx, Duration::from_millis(100), &hidden),
            Some(false)
        );
    }
}
