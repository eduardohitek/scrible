import { EditorView } from "@codemirror/view";

/**
 * Tema do CodeMirror consumindo os tokens de `src/theme/tokens.css` (#22).
 * Só cobre o que o CSS global não alcança de forma confiável: seleção,
 * cursor e o tooltip do menu `/` (slashMenu.ts) — CodeMirror injeta seu
 * próprio baseTheme para essas três coisas com prioridade que uma regra
 * solta em App.css não sobrepõe de forma previsível. Fonte/tamanho do
 * editor continuam vindo de `.editor-pane .cm-editor` em App.css (cascata
 * normal já funciona hoje para font-size).
 */
export const editorTheme = EditorView.theme({
  ".cm-content": {
    caretColor: "var(--color-accent)",
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
    borderRadius: "var(--radius-sm)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--color-selection-bg)",
    color: "var(--color-text)",
  },
  ".cm-panel.cm-search": {
    backgroundColor: "var(--color-surface-elevated)",
    color: "var(--color-text)",
    borderBottom: "1px solid var(--color-border)",
    boxShadow: "var(--shadow-panel)",
  },
  ".cm-search .cm-textfield": {
    backgroundColor: "var(--color-bg)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
  },
  ".cm-search .cm-button": {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  ".cm-search .cm-button:hover": {
    backgroundColor: "var(--color-selection-bg)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--color-search-match-bg)",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "var(--color-search-match-selected-bg)",
  },
});
