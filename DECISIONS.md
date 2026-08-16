# DECISIONS.md

Log cronológico de decisões de arquitetura tomadas por issue. Cada entrada registra o que foi decidido, por quê, e quais issues futuras isso pode afetar.

Antes de planejar uma nova issue, leia este arquivo inteiro — decisões de issues anteriores frequentemente restringem ou orientam issues futuras que dependem delas.

## #5 — Bootstrap do workspace (`~/Documents/scrible/` e `.scrible/`)

- Erro (`WorkspaceError`, `src-tauri/src/workspace.rs`): `thiserror` + `serde::Serialize`, `#[serde(tag = "kind", content = "message")]`, variantes `PermissionDenied`/`Io`.
- Paths fixos: root do usuário em `~/Documents/scrible/`; dados internos do app (não visíveis ao usuário) em `~/Documents/scrible/.scrible/`.
- Bootstrap é idempotente: `create_dir_all` + escrita/remoção de um arquivo-sonda para detectar diretórios pré-existentes sem permissão de escrita (criar o diretório não falha nesse caso — só uma escrita real revela o problema).
- Função pura (`ensure_workspace`) testável com `tempfile::tempdir()`, separada de um wrapper fino (`bootstrap`) que só resolve `document_dir()` via API do Tauri.

**Afeta:** qualquer issue que grave dados internos do app (histórico de versões `#8`, sessão `#9`) sabe que `.scrible/` é o lugar certo.

## #6 — Camada de arquivos em Rust com escrita atômica

- `FsError` (`src-tauri/src/fs_ops.rs`) é único, compartilhado pelos 5 commands (`read_file`, `save_file`, `rename_file`, `delete_file`, `list_dir`), com tag por variante (`#[serde(tag = "kind")]`) — não um enum por operação.
- `mtime` em **milissegundos** (`i64`) desde a época Unix, não segundos — granularidade de segundos seria grosseira demais para autosaves rápidos no mesmo segundo.
- Escrita atômica: grava em `<arquivo>.scrible-tmp` no mesmo diretório, `File::sync_all()` (fsync), depois `fs::rename` (atômico no mesmo filesystem). Sufixo **fixo**, não nome aleatório — decisão consciente que assume um único editor/janela escrevendo em cada arquivo por vez; revisitar se isso mudar (múltiplas janelas, mesmo arquivo).
- `save_file(path, content, expected_mtime: Option<i64>)`: se `expected_mtime` divergir do mtime atual em disco, retorna `FsError::ExternalChange { current_mtime, current_content }` sem tocar no arquivo — não sobrescreve, não faz retry automático.
- Nenhum dos 5 commands valida que `path` está dentro do workspace — decisão consciente, não descuido. Os commands operam em qualquer caminho absoluto do sistema, como um editor de texto genérico. Revisitar se o app ganhar mais superfície de ataque (plugins, conteúdo remoto, abertura de paths vindos de fora do processo).

**Afeta:** `#7` (consome `save_file`/`expected_mtime` para o autosave), `#10` (consome `ExternalChange` para o watcher de alteração externa), `#25` (consome `list_dir` para o explorador de arquivos).

## #7 — Autosave direto no arquivo original com debounce

- Escopo reduzido a **documento único** (sem abas ainda) — a issue, como escrita, pressupõe `src/store/` com estado por aba (`#9`/`#21`), que ainda não existem. `src/store/documentStore.ts` (zustand) foi desenhado para já encaixar quando `#21` vier multiplexá-lo por aba.
- Path padrão fixo: `~/Documents/scrible/untitled.md`, criado automaticamente no boot (via `read_file`/`save_file`) se ainda não existir — não há file picker nem issue de "abrir/criar arquivo" no backlog.
- Debounce de 800ms via `setTimeout` simples na store (sem lib de debounce). Gatilhos imediatos (`flush()`): blur da janela (`onFocusChanged` no JS) e fechamento do app.
- Fechamento do app: handshake `WindowEvent::CloseRequested` (Rust, `on_window_event` do `Builder`) → `api.prevent_close()` + `window.emit("app-close-requested")` → frontend escuta, chama `flush()`, e só então `invoke("quit_app")` (novo command, `app.exit(0)`) — evita perder a última alteração sem depender de um timeout arbitrário.
- `FsError::ExternalChange` (de `#6`) leva a `status: "conflict"` na store, guardando `current_mtime`/`current_content`, **sem retry automático nem sobrescrita** — fica pronto para a UI de reconciliação de `#10` consumir.
- Indicador visual "Salvando…" é um elemento fixo mínimo no `app-shell` (não na aba — `#21` não existe ainda).

**Afeta:** `#8` (decide se cria snapshot a cada save bem-sucedido), `#9` (sessão terá que substituir o path fixo por múltiplos paths persistidos e reconciliar com `documentStore`), `#10` (consome o estado `conflict`), `#21` (vai multiplexar `documentStore` por aba).

## #10 — Watcher de alteração externa e reconciliação

- Módulo `src-tauri/src/watcher.rs`, crate `notify = "6"`. Observa o **diretório pai** do arquivo (`~/Documents/scrible/`), não o arquivo diretamente — sobrevive ao arquivo ainda não existir no primeiro boot e ao rename atômico feito por qualquer programa (o próprio scrible incluído). `RecursiveMode::NonRecursive` restringe eventos aos filhos diretos do diretório, então escritas dentro de `.scrible/history/` não geram ruído.
- Supressão de eco: `LastSaveMtime` (`Arc<Mutex<Option<i64>>>`, gerenciado via `app.manage`) guarda o mtime do último `save_file` bem-sucedido do próprio scrible; o watcher ignora eventos cujo mtime em disco bate com esse valor. Não há pausa por janela de tempo — comparação de mtime é exata e não depende de latência de I/O.
- Debounce de rajadas de eventos (ex: temp+rename gera múltiplos eventos por escrita lógica) implementado inline em `watcher.rs` (buffer + 300ms de silêncio), sem adicionar `notify-debouncer-mini` como dependência nova — mesma postura de `#8`.
- Início do watch é automático no `setup()` do Rust, path fixo (`untitled.md`) — sem command start/stop, consistente com o escopo documento único de `#7`. Revisitar quando `#21` (abas) introduzir múltiplos arquivos abertos simultaneamente.
- `history::force_snapshot` (extraído de dentro de `restore_snapshot`, `#8`) é reaproveitado pelo novo command `snapshot_before_discard`: ao usuário escolher "usar versão do disco" num conflito, a versão local descartada é sempre snapshotada, bypassando o throttle de 5min.
- Frontend: novo campo `dirty: boolean` em `documentStore` (fonte única de verdade para "há edição local pendente"), `resolveConflict("mine" | "disk")` reaproveita o `status`/`conflict` já existentes de `#6`/`#7` (não um shape novo). UI: `src/conflict/ConflictBanner.tsx`, banner fixo não-modal (não um dialog bloqueante), consistente com o padrão visual de `HistoryPanel`/indicador de save.

**Afeta:** `#21` (o watcher terá que observar N arquivos, um por aba aberta, não mais um path fixo único).
