import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

/**
 * Preview inline nível 2 (#12): estiliza o texto ao redor dos marcadores de
 * sintaxe markdown (heading, negrito, itálico, código, riscado, link) sem
 * escondê-los — os marcadores em si só recebem opacidade reduzida via
 * `cm-md-marker`. Esconder marcadores fora da linha do cursor é nível 3
 * (#29, fora de escopo aqui).
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

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: { from: number; to: number; className: string }[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        const className = MARKER_NODES.has(node.type.name) ? "cm-md-marker" : NODE_CLASS[node.type.name];
        if (className && node.from < node.to) {
          ranges.push({ from: node.from, to: node.to, className });
        }
      },
    });
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, className } of ranges) {
    builder.add(from, to, Decoration.mark({ class: className }));
  }
  return builder.finish();
}

class MarkdownDecorationsPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

export function markdownDecorations() {
  return ViewPlugin.fromClass(MarkdownDecorationsPlugin, {
    decorations: (plugin) => plugin.decorations,
  });
}
