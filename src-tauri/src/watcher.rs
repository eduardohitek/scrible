use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{Event, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::fs_ops;

const DEBOUNCE: Duration = Duration::from_millis(300);

/// Último mtime (ms) conhecido de um `save_file` bem-sucedido do próprio
/// scrible. Permite ao watcher distinguir suas próprias escritas de
/// alterações externas de verdade, sem depender de pausar/ignorar o watcher
/// por uma janela de tempo (frágil com I/O lento).
#[derive(Clone, Default)]
pub struct LastSaveMtime(Arc<Mutex<Option<i64>>>);

impl LastSaveMtime {
    pub fn record(&self, mtime: i64) {
        *self.0.lock().unwrap() = Some(mtime);
    }

    fn get(&self) -> Option<i64> {
        *self.0.lock().unwrap()
    }
}

#[derive(Clone, Serialize)]
pub struct ExternalChangePayload {
    pub mtime: i64,
    pub content: String,
}

/// `true` quando o mtime observado em disco não corresponde ao último save
/// conhecido do próprio scrible — ou seja, é uma alteração externa de
/// verdade, não o eco do nosso próprio `save_file`.
fn is_external_change(current_mtime: i64, last_known_save_mtime: Option<i64>) -> bool {
    last_known_save_mtime != Some(current_mtime)
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

/// Observa o diretório que contém `target_path` — não o arquivo
/// diretamente, porque ele pode ainda não existir no primeiro boot, e
/// observar o diretório sobrevive ao rename atômico que outros programas
/// (e o próprio scrible) fazem ao salvar. `NonRecursive` restringe os
/// eventos aos filhos diretos do diretório, então mudanças dentro de
/// `.scrible/history/` não geram ruído aqui.
///
/// Roda pro resto da vida do processo (sem comando start/stop) — escopo
/// documento único, path fixo, consistente com a decisão de #7.
pub fn start_watching(app: AppHandle, target_path: PathBuf, last_save_mtime: LastSaveMtime) {
    std::thread::spawn(move || {
        let Some(watch_dir) = target_path.parent().map(|dir| dir.to_path_buf()) else {
            eprintln!("watcher: caminho sem diretório pai: {}", target_path.display());
            return;
        };

        let (tx, rx) = mpsc::channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(watcher) => watcher,
            Err(err) => {
                eprintln!("watcher: falha ao criar: {err}");
                return;
            }
        };

        if let Err(err) = watcher.watch(&watch_dir, RecursiveMode::NonRecursive) {
            eprintln!("watcher: falha ao observar {}: {err}", watch_dir.display());
            return;
        }

        while wait_for_settled_event(&rx, DEBOUNCE) {
            let Ok(meta) = std::fs::metadata(&target_path) else {
                continue;
            };
            let Ok(current_mtime) = fs_ops::mtime_millis(&meta) else {
                continue;
            };

            if !is_external_change(current_mtime, last_save_mtime.get()) {
                continue;
            }

            let Ok(content) = std::fs::read_to_string(&target_path) else {
                continue;
            };

            let _ = app.emit(
                "external-file-changed",
                ExternalChangePayload {
                    mtime: current_mtime,
                    content,
                },
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_change_when_no_save_is_known_yet() {
        assert!(is_external_change(1000, None));
    }

    #[test]
    fn reports_change_when_mtime_differs_from_last_save() {
        assert!(is_external_change(2000, Some(1000)));
    }

    #[test]
    fn suppresses_echo_when_mtime_matches_last_save() {
        assert!(!is_external_change(1000, Some(1000)));
    }

    #[test]
    fn last_save_mtime_is_shared_across_clones() {
        let state = LastSaveMtime::default();
        let clone = state.clone();

        clone.record(4242);

        assert_eq!(state.get(), Some(4242));
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
