import type { SyntaxNode } from "@lezer/common";
import { EditorSelection, type Extension, Prec, type StateCommand } from "@codemirror/state";
import { type KeyBinding, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

/**
 * Autocomplete grupo A (#13): comportamentos automáticos de digitação —
 * continuação/encerramento de listas no Enter já vêm de graça do
 * `markdownKeymap` do `@codemirror/lang-markdown` (ver EditorPane.tsx).
 * Este módulo cobre o que a lib não oferece: indentação de listas
 * ciente de marcador (Tab/Shift-Tab), envolver seleção ao digitar um
 * marcador, e os atalhos de formatação.
 */

interface ListLineInfo {
  indent: string;
  marker: string;
  spacing: string;
  ordered: boolean;
  number?: number;
  delimiter?: string;
}

const ORDERED_LIST_RE = /^(\s*)(\d{1,9})([.)])(\s+)/;
const BULLET_LIST_RE = /^(\s*)([-+*])(\s+)/;

function parseListLine(text: string): ListLineInfo | null {
  const ordered = ORDERED_LIST_RE.exec(text);
  if (ordered) {
    const [, indent, number, delimiter, spacing] = ordered;
    return { indent, marker: number + delimiter, spacing, ordered: true, number: Number(number), delimiter };
  }
  const bullet = BULLET_LIST_RE.exec(text);
  if (bullet) {
    const [, indent, marker, spacing] = bullet;
    return { indent, marker, spacing, ordered: false };
  }
  return null;
}

function findEnclosingListItem(state: Parameters<StateCommand>[0]["state"], pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node && node.name !== "ListItem") {
    node = node.parent;
  }
  return node;
}

/** Tab: aninha o item atual sob o item-irmão anterior, alinhando com a
 * coluna real de conteúdo dele (não uma largura fixa) — CommonMark só
 * reconhece a sublista se o alinhamento bater. Sem irmão anterior (é o
 * primeiro item da lista), não faz nada. */
export const listIndent: StateCommand = ({ state, dispatch }) => {
  const pos = state.selection.main.head;
  const item = findEnclosingListItem(state, pos);
  if (!item) return false;
  const prevItem = item.prevSibling;
  if (!prevItem || prevItem.name !== "ListItem") return false;

  const line = state.doc.lineAt(pos);
  const currentInfo = parseListLine(line.text);
  if (!currentInfo) return false;

  const prevLine = state.doc.lineAt(prevItem.from);
  const prevInfo = parseListLine(prevLine.text);
  if (!prevInfo) return false;

  const newIndentLength = prevInfo.indent.length + prevInfo.marker.length + prevInfo.spacing.length;
  const newMarker = currentInfo.ordered ? `1${currentInfo.delimiter}` : currentInfo.marker;

  const oldPrefixLength = currentInfo.indent.length + currentInfo.marker.length + currentInfo.spacing.length;
  const rest = line.text.slice(oldPrefixLength);
  const newLineText = " ".repeat(newIndentLength) + newMarker + currentInfo.spacing + rest;

  const offsetInRest = Math.max(0, pos - line.from - oldPrefixLength);
  const newPrefixLength = newIndentLength + newMarker.length + currentInfo.spacing.length;

  dispatch(
    state.update({
      changes: { from: line.from, to: line.to, insert: newLineText },
      selection: EditorSelection.cursor(line.from + newPrefixLength + offsetInRest),
      userEvent: "input",
      scrollIntoView: true,
    }),
  );
  return true;
};

/** Shift-Tab: promove o item atual para o nível do item-pai (item da
 * lista que contém a lista atual), alinhando com a indentação dele. Sem
 * item-pai (já no nível raiz), não faz nada. Renumera só o item movido,
 * não os irmãos seguintes (fora de escopo — ver DECISIONS.md). */
export const listOutdent: StateCommand = ({ state, dispatch }) => {
  const pos = state.selection.main.head;
  const item = findEnclosingListItem(state, pos);
  if (!item) return false;
  const list = item.parent;
  if (!list) return false;
  const parentItem = list.parent;
  if (!parentItem || parentItem.name !== "ListItem") return false;

  const line = state.doc.lineAt(pos);
  const currentInfo = parseListLine(line.text);
  if (!currentInfo) return false;

  const parentLine = state.doc.lineAt(parentItem.from);
  const parentInfo = parseListLine(parentLine.text);
  if (!parentInfo) return false;

  const newIndentLength = parentInfo.indent.length;
  const newMarker = parentInfo.ordered ? `${(parentInfo.number ?? 0) + 1}${parentInfo.delimiter}` : parentInfo.marker;

  const oldPrefixLength = currentInfo.indent.length + currentInfo.marker.length + currentInfo.spacing.length;
  const rest = line.text.slice(oldPrefixLength);
  const newLineText = " ".repeat(newIndentLength) + newMarker + currentInfo.spacing + rest;

  const offsetInRest = Math.max(0, pos - line.from - oldPrefixLength);
  const newPrefixLength = newIndentLength + newMarker.length + currentInfo.spacing.length;

  dispatch(
    state.update({
      changes: { from: line.from, to: line.to, insert: newLineText },
      selection: EditorSelection.cursor(line.from + newPrefixLength + offsetInRest),
      userEvent: "input",
      scrollIntoView: true,
    }),
  );
  return true;
};

/** Digitar `marker` com uma seleção não-vazia envolve a seleção em vez de
 * substituí-la; sem seleção, deixa a digitação normal acontecer (retorna
 * `false`). Usado para `*`, `_`, `` ` `` e `~~` (riscado GFM, dobrado). */
function createWrapOnType(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    if (state.selection.ranges.every((range) => range.empty)) return false;
    const result = state.changeByRange((range) => {
      if (range.empty) return { range };
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + marker.length, range.to + marker.length),
      };
    });
    dispatch(state.update(result, { userEvent: "input", scrollIntoView: true }));
    return true;
  };
}

export const wrapAsterisk = createWrapOnType("*");
export const wrapUnderscore = createWrapOnType("_");
export const wrapBacktick = createWrapOnType("`");
export const wrapTilde = createWrapOnType("~~");

/** Cmd+B/Cmd+I: alterna (toggle) o marcador ao redor da seleção — remove
 * se já estiver envolvida (ou colada nas bordas) pelo marcador, envolve
 * caso contrário. Sem seleção, insere o par vazio com o cursor entre os
 * marcadores. */
function toggleWrap(marker: string): StateCommand {
  const len = marker.length;
  return ({ state, dispatch }) => {
    const result = state.changeByRange((range) => {
      const { from, to } = range;
      const before = state.sliceDoc(Math.max(0, from - len), from);
      const after = state.sliceDoc(to, Math.min(state.doc.length, to + len));
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: from - len, to: from },
            { from: to, to: to + len },
          ],
          range: EditorSelection.range(from - len, to - len),
        };
      }
      const innerBefore = state.sliceDoc(from, Math.min(to, from + len));
      const innerAfter = state.sliceDoc(Math.max(from, to - len), to);
      if (to - from >= len * 2 && innerBefore === marker && innerAfter === marker) {
        return {
          changes: [
            { from, to: from + len },
            { from: to - len, to },
          ],
          range: EditorSelection.range(from, to - len * 2),
        };
      }
      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + len, to + len),
      };
    });
    dispatch(state.update(result, { userEvent: "input", scrollIntoView: true }));
    return true;
  };
}

export const toggleBold = toggleWrap("**");
export const toggleItalic = toggleWrap("*");

/** Cmd+K: com seleção, `[selecionado](url)` com o cursor sobre `url`
 * pronto pra digitar; sem seleção, `[texto](url)` com o cursor sobre
 * `texto`. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const result = state.changeByRange((range) => {
    if (range.empty) {
      const placeholder = "texto";
      return {
        changes: { from: range.from, insert: `[${placeholder}](url)` },
        range: EditorSelection.range(range.from + 1, range.from + 1 + placeholder.length),
      };
    }
    const selected = state.sliceDoc(range.from, range.to);
    const urlPlaceholder = "url";
    const urlStart = range.from + 1 + selected.length + 2;
    return {
      changes: { from: range.from, to: range.to, insert: `[${selected}](${urlPlaceholder})` },
      range: EditorSelection.range(urlStart, urlStart + urlPlaceholder.length),
    };
  });
  dispatch(state.update(result, { userEvent: "input", scrollIntoView: true }));
  return true;
};

const bindings: readonly KeyBinding[] = [
  { key: "Tab", run: listIndent },
  { key: "Shift-Tab", run: listOutdent },
  { key: "*", run: wrapAsterisk },
  { key: "_", run: wrapUnderscore },
  { key: "`", run: wrapBacktick },
  { key: "~", run: wrapTilde },
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-k", run: insertLink },
];

/** Precedência alta, mesmo padrão do `markdownKeymap` da lib — garante
 * que Cmd+I vença o `selectParentSyntax` do defaultKeymap. */
export const markdownEditingKeymap: Extension = Prec.high(keymap.of(bindings));
