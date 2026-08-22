# Plan: #24 — Menu nativo do macOS e atalhos de teclado

**Date:** 2026-08-22
**Status:** Approved

---

## Objective

Dar ao scrible uma barra de menu nativa de macOS (Arquivo/Editar/Visualizar/Janela + menu de app
"scrible") que dispare as mesmas ações já implementadas nas issues anteriores (#7, #16, #19, #21,
#23), sem duplicar lógica, e fechar a lacuna de "abrir um arquivo existente" que #21 deixou
pendente (`openTab(path)` já existe, sem gatilho de UI).

---

## Decisões da sabatina

1. **Abrir arquivo (Cmd+O)**: "Abrir pasta" no texto da issue é, na prática, abrir um `.md`
   existente (confirmado em `DECISIONS.md #21`). Implementado com `tauri-plugin-dialog` (nova
   dependência Rust+JS), seletor nativo filtrado por `.md`, chamando `tabsStore.openTab(path)`.
2. **"Novo" usa Cmd+T** (não Cmd+N do texto da issue) — coincide com o atalho já implementado em
   `useTabShortcuts.ts`.
3. **Exportar HTML/PDF**: omitido do menu Arquivo nesta issue — #26/#27 não existem ainda.
4. **Tema no menu Visualizar**: 3 itens planos (Sistema/Claro/Escuro), sem checkmark nativo
   sincronizado.
5. **Renomear**: `editingTabId`/`draftTitle` sobem de `TabBar.tsx` (estado local) para `tabsStore`
   (`startRenaming`/`cancelRenaming`/`commitRenaming`).
6. **Sair (Cmd+Q)**: item customizado cujo handler em Rust chama `window.close()` — reaproveita o
   handshake de flush já existente via `WindowEvent::CloseRequested`, em vez de
   `PredefinedMenuItem::quit()` (que pularia o flush).

**Achado técnico**: no macOS, um `NSMenuItem` com accelerator intercepta o evento de teclado antes
de chegar à `WKWebView` — os listeners JS equivalentes (`useTabShortcuts.ts` para `t`/`w`,
`useLayoutShortcuts.ts` inteiro para Cmd+Shift+P, `searchKeymap` do CodeMirror para abrir com Cmd+F)
viram inalcançáveis assim que os itens nativos existirem. O plano remove esse código morto.

---

## Implementation Steps

1. Criar branch `feat/24-menu-nativo-atalhos` a partir de `main` atualizada.
2. **Backend**: novo `src-tauri/src/app_menu.rs` (build do `Menu` via `MenuBuilder`/`SubmenuBuilder`),
   chamado do `setup()` em `lib.rs`; `app.on_menu_event` despachando `"quit"` → `window.close()`,
   demais ids customizados → `app.emit("menu", id)`.
3. Adicionar dependência `tauri-plugin-dialog` (Cargo.toml + `lib.rs` + `capabilities/default.json`
   com `"dialog:default"`) e `@tauri-apps/plugin-dialog` no `package.json`.
4. **Frontend — stores**: `tabsStore.ts` ganha `editingTabId`/`startRenaming`/`cancelRenaming`/
   `commitRenaming`/`openFileDialog`.
5. **Frontend — componentes**: `TabBar.tsx` migra pro estado do store; `EditorPane.tsx` ganha
   `openSearch()` na handle imperativa; `SplitLayout.tsx` vira `forwardRef` expondo `openSearch`.
6. **Frontend — App.tsx**: `splitLayoutRef` + listener `listen<string>("menu", ...)` despachando
   pros stores/ref conforme o id do evento.
7. Remover `t`/`w` de `useTabShortcuts.ts` (+ testes) e apagar `useLayoutShortcuts.ts`/teste por
   completo, junto com o import/uso em `App.tsx`.
8. Testes automatizados: `tabsStore.test.ts`, `TabBar.test.tsx`, `useTabShortcuts.test.ts`,
   `EditorPane.test.tsx`.
9. Verificação manual via `mise run dev` (checklist completo no plano de implementação salvo em
   `/Users/eduardohitek/.claude/plans/hashed-sleeping-kitten.md`).
10. `mise run lint`, `mise run typecheck`, `mise run test`.
11. Atualizar `DECISIONS.md` com as decisões acima + achado técnico sobre precedência de
    accelerators nativos.
12. Commit, push, abrir PR com `Closes #24`.

---

## Expected Outcomes

- Barra de menu nativa "scrible" no macOS com Arquivo/Editar/Visualizar/Janela funcionais.
- Cmd+O abre um seletor nativo de arquivo `.md` e abre a aba correspondente.
- Renomear, buscar, alternar preview e trocar tema disparáveis via menu, reaproveitando as ações já
  existentes nos respectivos stores.
- Sair (Cmd+Q ou menu) preserva o autosave pendente antes de fechar.
- Nenhuma lógica duplicada entre menu nativo e listeners JS — os JS listeners que ficariam
  inalcançáveis foram removidos.

---

## Risks & Considerations

- API exata do `tauri::menu` (nomes de builders como `.maximize()` para "zoom") será confirmada em
  tempo de compilação/teste manual, não só pela documentação consultada.
- Remoção de `useTabShortcuts.ts` (branches `t`/`w`) e de `useLayoutShortcuts.ts` inteiro é uma
  mudança além do texto literal da issue — justificada pelo achado de que esses atalhos ficam
  inalcançáveis com o menu nativo presente, mas vale atenção na revisão do PR.
- Sem teste automatizado para o wiring do menu nativo em si (`app_menu.rs`/dispatch do evento
  `"menu"` em `App.tsx`) — mesma postura já registrada em `DECISIONS.md` para #22/#23. Verificação
  real é manual via `mise run dev`.
