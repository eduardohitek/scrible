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
