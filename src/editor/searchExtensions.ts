import { EditorView, keymap } from "@codemirror/view";
import { search, openSearchPanel } from "@codemirror/search";

/**
 * Busca e substituição (#16): `searchKeymap` (Mod-f/Mod-g/Esc/Enter/Shift-Enter)
 * já está registrado em `editorStateRegistry.ts` desde antes desta issue, mas
 * sem a extensão `search()` em si o painel nunca existia — Cmd+F não fazia
 * nada. `top: true` abre o painel no topo do editor, conforme a issue.
 *
 * A versão instalada da lib não tem um estado "só busca" vs "busca com
 * substituição visível" — o painel padrão sempre mostra os dois campos
 * juntos. Cmd+Option+F por isso não abre um painel diferente: só move o
 * foco pro campo de substituição depois de abrir o mesmo painel de sempre.
 */
function openSearchPanelWithReplaceFocus(view: EditorView): boolean {
  openSearchPanel(view);
  const replaceField = view.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]');
  replaceField?.focus();
  return true;
}

export const searchExtensions = [
  search({ top: true }),
  keymap.of([{ key: "Mod-Alt-f", run: openSearchPanelWithReplaceFocus, preventDefault: true }]),
];
