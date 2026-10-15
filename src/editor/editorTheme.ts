import { EditorView } from "@codemirror/view";

/**
 * Tema do CodeMirror consumindo os tokens de `src/theme/tokens.css` (#22).
 * Só cobre o que o CSS global não alcança de forma confiável: seleção,
 * cursor e o tooltip do menu `/` (slashMenu.ts) — CodeMirror injeta seu
 * próprio baseTheme para essas três coisas com prioridade que uma regra
 * solta em App.css não sobrepõe de forma previsível. Fonte/tamanho do
 * editor continuam vindo de `.editor-pane .cm-editor` em App.css (cascata
 * normal já funciona hoje para font-size).
 *
 * Respiro da área de escrita (padding lateral, entrelinha) também vive aqui:
 * `.cm-scroller`/`.cm-content`/`.cm-line` recebem padding/font do baseTheme
 * do CodeMirror. O padding vertical fica pequeno de propósito — o scroll sync
 * (#20) mede `lineBlockAt().top`, que não inclui esse deslocamento.
 */
export const editorTheme = EditorView.theme({
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.7",
  },
  ".cm-content": {
    caretColor: "var(--color-accent)",
    padding: "var(--space-4) 0",
  },
  ".cm-line": {
    padding: "0 var(--space-6)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-accent)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--color-selection-bg)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--color-surface-elevated)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-panel)",
    padding: "var(--space-1)",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete ul li": {
    borderRadius: "var(--radius-sm)",
    padding: "3px var(--space-2) !important",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--color-accent-soft)",
    color: "var(--color-text)",
  },
  ".cm-panels": {
    backgroundColor: "var(--color-surface-elevated)",
    color: "var(--color-text)",
  },
  ".cm-panels-top": {
    borderBottom: "1px solid var(--color-border-subtle)",
  },
  ".cm-panel.cm-search": {
    backgroundColor: "var(--color-surface-elevated)",
    color: "var(--color-text)",
    padding: "var(--space-2) var(--space-6)",
    fontFamily: "var(--font-reading)",
    fontSize: "var(--font-size-sm)",
  },
  ".cm-search .cm-textfield": {
    backgroundColor: "var(--color-bg)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    padding: "3px var(--space-2)",
    outline: "none",
  },
  ".cm-search .cm-textfield:focus": {
    borderColor: "var(--color-accent)",
    boxShadow: "0 0 0 3px var(--color-accent-soft)",
  },
  ".cm-search .cm-button": {
    backgroundColor: "var(--color-surface)",
    backgroundImage: "none",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    padding: "3px var(--space-2)",
    cursor: "pointer",
  },
  ".cm-search .cm-button:hover": {
    backgroundColor: "var(--color-surface-hover)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--color-search-match-bg)",
    borderRadius: "2px",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "var(--color-search-match-selected-bg)",
  },
});
