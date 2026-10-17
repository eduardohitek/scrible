import { RangeSet, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";

/**
 * Preview inline nível 2 (#12): estiliza o texto ao redor dos marcadores de
 * sintaxe markdown (heading, negrito, itálico, código, riscado, link) sem
 * escondê-los — os marcadores em si só recebem opacidade reduzida via
 * `cm-md-marker`.
 *
 * Nível 3 (#29, opcional via `markdownDecorations(true)`): marcadores fora
 * das linhas tocadas pela seleção somem de verdade (`Decoration.replace`) —
 * o documento nunca muda, então copiar/colar e o autosave seguem usando o
 * markdown real. O critério é a linha inteira (não só o nó), de modo que um
 * marcador nunca aparece ou some sob o cursor enquanto ele se move dentro
 * da mesma linha.
 */
const NODE_CLASS: Record<string, string> = {
  ATXHeading1: "cm-md-h1",
  ATXHeading2: "cm-md-h2",
  ATXHeading3: "cm-md-h3",
  ATXHeading4: "cm-md-h4",
  ATXHeading5: "cm-md-h5",
  ATXHeading6: "cm-md-h6",
  StrongEmphasis: "cm-md-strong",
  Emphasis: "cm-md-em",
  Strikethrough: "cm-md-strike",
  InlineCode: "cm-md-inline-code",
  FencedCode: "cm-md-fenced-code",
  Link: "cm-md-link",
};

const MARKER_NODES = new Set(["HeaderMark", "EmphasisMark", "CodeMark", "StrikethroughMark", "LinkMark"]);

interface Built {
  all: DecorationSet;
  hidden: DecorationSet;
}

const HIDDEN = Decoration.replace({});

/** Marcador que o nível 3 pode esconder, ou `null` se deve ficar sempre
 * visível (fences, citação, listas, imagens, links por referência). Devolve
 * o intervalo a esconder — o `#` de heading leva junto o espaço seguinte. */
function hiddenRange(node: SyntaxNodeRef, view: EditorView): { from: number; to: number } | null {
  const name = node.type.name;
  const parent = node.node.parent;
  switch (name) {
    case "HeaderMark": {
      if (node.from !== view.state.doc.lineAt(node.from).from) return null;
      const hasSpace = view.state.sliceDoc(node.to, node.to + 1) === " ";
      return { from: node.from, to: hasSpace ? node.to + 1 : node.to };
    }
    case "EmphasisMark":
    case "StrikethroughMark":
      return { from: node.from, to: node.to };
    case "CodeMark":
      return parent?.name === "InlineCode" ? { from: node.from, to: node.to } : null;
    case "LinkMark":
    case "URL":
    case "LinkTitle":
      return parent?.name === "Link" && parent.getChild("URL") ? { from: node.from, to: node.to } : null;
    default:
      return null;
  }
}

function buildDecorations(view: EditorView, hideMarkers: boolean): Built {
  const marks: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];

  const touchedLines = hideMarkers
    ? view.state.selection.ranges.map((range) => ({
        from: view.state.doc.lineAt(range.from).from,
        to: view.state.doc.lineAt(range.to).to,
      }))
    : [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.from >= node.to) return;
        const isMarker = MARKER_NODES.has(node.type.name);
        if (hideMarkers) {
          const range = hiddenRange(node, view);
          if (range && !touchedLines.some((line) => range.from <= line.to && range.to >= line.from)) {
            // Replace de ViewPlugin não pode cruzar quebra de linha (o
            // CodeMirror desativa o plugin): fatia o intervalo por linha.
            for (let pos = range.from; pos < range.to; ) {
              const line = view.state.doc.lineAt(pos);
              const end = Math.min(range.to, line.to);
              if (end > pos) hidden.push(HIDDEN.range(pos, end));
              pos = line.to + 1;
            }
            return;
          }
        }
        const className = isMarker ? "cm-md-marker" : NODE_CLASS[node.type.name];
        if (className) marks.push(Decoration.mark({ class: className }).range(node.from, node.to));
      },
    });
  }

  const hiddenSet = RangeSet.of(hidden, true);
  return { all: RangeSet.of([...marks, ...hidden], true), hidden: hiddenSet };
}

function createPlugin(hideMarkers: boolean) {
  class MarkdownDecorationsPlugin implements PluginValue {
    decorations: DecorationSet;
    hidden: DecorationSet;

    constructor(view: EditorView) {
      ({ all: this.decorations, hidden: this.hidden } = buildDecorations(view, hideMarkers));
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || (hideMarkers && update.selectionSet)) {
        ({ all: this.decorations, hidden: this.hidden } = buildDecorations(update.view, hideMarkers));
      }
    }
  }

  return ViewPlugin.fromClass(MarkdownDecorationsPlugin, {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.hidden ?? Decoration.none),
  });
}

// Duas instâncias fixas (uma por nível): o registry compara por identidade
// pra saber se o `EditorState` de uma aba já está no nível atual.
const level2 = createPlugin(false);
const level3 = createPlugin(true);

export function markdownDecorations(hideMarkers = false) {
  return hideMarkers ? level3 : level2;
}
