# Plan: Explorador de arquivos lateral (#25)

**Date:** 2026-08-22
**Status:** Approved
**Branch:** `feat/25-explorador-de-arquivos`

---

## Objective

Painel lateral (sidebar) navegável mostrando a árvore de arquivos `.md` de `~/Documents/scrible/`,
com criar, renomear e excluir, refletindo mudanças externas automaticamente e integrando com o
sistema de abas existente (`tabsStore`/`documentStore`).

---

## Decisões (sabatina)

1. **Fetch da árvore**: novo command Rust `list_dir_entries(path) -> Vec<{name, is_dir}>`, chamado
   lazy por pasta expandida — não uma árvore recursiva completa numa só chamada. `list_dir`
   existente (flat, usado por `tabsStore.newTab`) permanece intocado.
2. **Watcher**: novo watcher recursivo dedicado (`RecursiveMode::Recursive` na raiz do workspace),
   só para o explorador, emitindo evento leve `"workspace-tree-changed"` sem payload. Não toca no
   watcher existente de reconciliação de conflito (`watcher.rs`, #7/#10/#21).
3. **Filtro**: só arquivos `.md` + pastas; oculta dotfiles/dotdirs (esconde `.scrible/` de graça).
4. **Criar arquivo**: reaproveita o padrão `untitled-N` de `tabsStore.newTab`, generalizado para
   aceitar diretório alvo; abre a aba automaticamente. Nova pasta usa o mesmo idioma incremental
   (`nova-pasta`/`nova-pasta-N`).
5. **Dir ops (Rust)**: `create_dir` + `delete_dir` dedicados em `fs_ops.rs`, seguindo o padrão
   single-purpose já estabelecido (`rename_file`, `delete_file`). `rename_file` já é genérico o
   suficiente para renomear pastas também — sem mudança.
6. **Menu de contexto**: dropdown HTML customizado posicionado no clique, mesmo idioma de
   `HistoryPanel`/`ThemeToggle` (fecha com clique fora/Esc). Sem round-trip pro Rust.
7. **Aba aberta**: renomear sincroniza a aba (`tabsStore.syncPathsAfterRename`, com prefix-match
   para descendentes de pasta renomeada); excluir fecha a aba automaticamente após confirmação, sem
   tentar salvar antes (evita recriar o arquivo apagado).
8. **Layout**: sidebar full-height à esquerda de `TabBar`+`SplitLayout`, com uma aba fina fixa na
   borda para toggle (evita colidir com os 4 botões de canto já existentes: tema, histórico,
   preview, indicador de salvamento) + atalho `Cmd+Shift+E` + item `"Alternar explorador"` no menu
   nativo (submenu Visualizar, espelhando `toggle_preview`). Largura/visibilidade persistidas em
   `appSettings.ts` (nova chave `explorer`).
9. **Local de criação**: "Novo arquivo"/"Nova pasta" nascem na pasta-mãe do item clicado (ou raiz,
   se fora de qualquer pasta).
10. **Confirmação de exclusão**: `tauri-plugin-dialog` `ask()` (já é dependência desde #24).
11. **Estado expandido/colapsado**: não persistido — vive em `explorerStore` (zustand), reseta a
    cada boot.
12. **Testes**: cobertura automatizada para toda lógica pura/testável (fs_ops novo, watcher novo,
    stores, prefix-matching de rename/delete). Sem teste dedicado para o posicionamento visual do
    menu de contexto — mesma postura já usada em #22/#23/#24.

---

## Implementation Steps

### Backend (Rust)

1. `fs_ops.rs`: `DirEntry { name, is_dir }` + `list_dir_entries` (filtra dotfiles/dotdirs, filtra
   não-`.md`, ordena pastas antes de arquivos, depois alfabético case-insensitive). `create_dir`
   (`fs::create_dir`). `delete_dir` (`fs::remove_dir_all`). Testes `tempdir()` cobrindo filtro e
   ordenação.
2. Novo `tree_watcher.rs`: watcher recursivo na raiz do workspace, reaproveita
   `wait_for_settled_event` de `watcher.rs` (torna-se `pub(crate)`), ignora eventos dentro de
   `.scrible/`, emite `"workspace-tree-changed"`.
3. `lib.rs`: registra `list_dir_entries`, `create_dir`, `delete_dir`; inicia `tree_watcher` no
   `setup()`.
4. `app_menu.rs`: item `toggle_explorer` no submenu Visualizar.

### Frontend

5. Novo `src/explorer/`:
   - `explorerStore.ts`: `visible`, `width`, `expandedDirs`, cache `entriesByDir`. Ações `init`,
     `toggle`, `setWidth`, `toggleDir` (fetch lazy), `refreshDir`, `createFile`/`createFolder`,
     `renameEntry`, `deleteEntry`. Assina `"workspace-tree-changed"`.
   - `ExplorerPanel.tsx`: árvore recursiva, clique abre aba (`tabsStore.openTab`), clique direito
     abre `ExplorerContextMenu`.
   - `ExplorerContextMenu.tsx`: dropdown HTML posicionado no clique.
   - `ExplorerToggleTab.tsx`: aba fina fixa na borda esquerda.
   - `useExplorerShortcuts.ts`: `Cmd+Shift+E`.
6. `tabsStore.ts`: `newTab` aceita diretório alvo opcional; novo `syncPathsAfterRename`; `closeTab`
   ganha `opts?: { skipFlush?: boolean }`.
7. `settings/appSettings.ts`: nova chave `explorer: { visible, width }` com merge dedicado.
8. `App.tsx`/`App.css`: `app-shell` vira row com o explorador à esquerda; `case "toggle_explorer"`
   no listener de menu; handle de resize simples com `MIN_PANE_WIDTH_PX`.

### Verificação

9. `mise run lint`, `mise run typecheck`, `mise run test`, verificação manual via `mise run dev`.
10. Atualizar `DECISIONS.md` com o registro da issue #25 antes de considerar o trabalho fechado.

---

## Expected Outcomes

- Painel lateral funcional mostrando a árvore `.md` do workspace, com criar/renomear/excluir
  refletindo no disco e na UI.
- Mudança externa (`mv`/criação via terminal) atualiza a árvore automaticamente.
- Clicar num arquivo abre a aba correta; renomear/excluir um arquivo com aba aberta mantém tudo
  consistente.
- PR aberto com `Closes #25`.

---

## Risks & Considerations

- Renomear/excluir uma pasta com várias abas abertas dentro dela depende do prefix-match em
  `syncPathsAfterRename`/`deleteEntry` — testar esse caso explicitamente.
- Watcher recursivo pode gerar mais eventos que o esperado em workspaces grandes; o filtro de
  `.scrible/` reduz ruído, mas não há throttle adicional além do debounce de 300ms herdado.
- Handle de resize da sidebar é uma implementação nova e simples (não reaproveita `SplitLayout`) —
  risco baixo, mas é mais uma superfície de drag a manter.
