# Plan: Exportar para HTML standalone (#26)

**Date:** 2026-08-23
**Status:** Approved
**Branch:** `feat/26-exportar-html-standalone`

---

## Objective

Exportar o documento ativo como um `.html` standalone (CSS embutido, sem dependências externas),
preservando a renderização de diagramas mermaid como SVG estático, usando o pipeline de
`src/preview/` (#17) como fonte da verdade e o diálogo nativo de salvar (`tauri-plugin-dialog`).
Depende de #17, #18 e #23 — todas fechadas.

---

## Decisão (sabatina)

O export sempre usa o tema atualmente resolvido na tela (`useThemeStore.getState().resolved`), sem
diálogo adicional de escolha claro/escuro — garante fidelidade exata ao preview no momento do
export, inclusive o SVG do mermaid (já renderizado com paleta fixa por tema).

---

## Implementation Steps

1. **`src/preview/markdownPipeline.ts`** (novo): extraída de `PreviewPane.tsx` sem mudança de
   comportamento — instância `md` (GFM + footnote + taskLists + sourceLinePlugin),
   `extractFrontMatter`, `renderFrontMatterTable`, `escapeHtml`. `PreviewPane.tsx` passa a importar
   daqui.
2. **`src/preview/PreviewPane.css`** (novo): extraído de `App.css` (`.preview-pane`,
   `.mermaid-diagram`/`.mermaid-error`, tabelas, `.front-matter*`). `App.tsx` importa o arquivo
   normalmente; o export importa o mesmo arquivo como texto cru via `?raw`.
3. **`src/export/exportHtml.ts`** (novo):
   - `renderStaticBodyHtml(source, theme)` — mesma sequência do efeito de mermaid de
     `PreviewPane.tsx`, mas função pura assíncrona sobre um `<div>` desanexado, rodando sobre o
     conteúdo vivo da aba (não debounced), resolvendo todos os blocos mermaid com
     `await Promise.all(...)`.
   - `buildStandaloneHtml(bodyHtml, theme, title)` — documento completo com `tokens.css` +
     `PreviewPane.css` embutidos via `?raw`, mais um pequeno CSS de plataforma
     (`color-scheme`/`body`) hardcoded.
   - `exportActiveTabAsHtml()` — lê aba ativa de `tabsStore`/`documentStore`, chama `save()` de
     `@tauri-apps/plugin-dialog`, e `invoke("write_export_file", ...)`.
4. **`write_export_file`** (novo command Rust, `fs_ops.rs`/`lib.rs`) — `fs::write` simples, sem
   reaproveitar `save_file` (que tem efeitos colaterais de autosave/histórico irrelevantes pra um
   path de export arbitrário).
5. **Menu nativo**: item `export_html` em `file_menu` (`app_menu.rs`); `App.tsx` ganha o `case`
   correspondente no listener de `"menu"`.
6. **`DECISIONS.md`**: nova entrada `#26` registrando as decisões acima e o achado de que o Vitest
   zera imports de `.css` (inclusive `?raw`) por padrão — corrigido com `test: { css: true }` em
   `vite.config.ts`.

---

## Expected Outcomes

- Menu Arquivo → "Exportar para HTML…" gera um `.html` que abre em qualquer navegador sem rede,
  reproduzindo tabela, task list, front matter e diagrama mermaid como SVG estático.
- Pipeline de markdown e CSS de conteúdo do preview passam a ter fonte única compartilhada entre
  app e export.
- 185 testes JS + 40 testes Rust passando; lint e typecheck limpos.

---

## Risks & Considerations

- Verificação manual completa (clicar no menu, abrir o `.html` gerado num navegador) não foi
  possível neste ambiente — é um app nativo macOS (Tauri/WKWebView), sem driver headless
  disponível. O boot em `mise run dev` foi confirmado sem erros de compilação/runtime; o
  comportamento do export em si está coberto por testes automatizados
  (`src/export/exportHtml.test.ts`) cobrindo markdown básico, sanitização, mermaid válido/inválido
  e o HTML final sem referências de rede. Recomenda-se um teste manual do usuário antes de
  considerar a issue definitivamente fechada.
