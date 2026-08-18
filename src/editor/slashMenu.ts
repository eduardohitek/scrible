import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

/**
 * Autocomplete grupo B (#14): menu de comandos acionado por `/` no início de
 * uma linha vazia. Cada item é um `snippetCompletion` — os tabstops `${...}`
 * cuidam do posicionamento do cursor e da navegação via Tab entre campos
 * (comportamento embutido do `snippet()` do `@codemirror/autocomplete`, sem
 * precisar de keymap próprio).
 */
const SLASH_COMMANDS: readonly Completion[] = [
  snippetCompletion("| ${Coluna 1} | ${Coluna 2} |\n| --- | --- |\n| ${dado 1} | ${dado 2} |", {
    label: "Tabela",
  }),
  snippetCompletion("```\n${código}\n```", { label: "Bloco de código" }),
  snippetCompletion("```mermaid\nflowchart TD\n    ${A[Início]} --> ${B[Fim]}\n```", {
    label: "Diagrama mermaid",
  }),
  snippetCompletion("- [ ] ${tarefa}", { label: "Lista de tarefas" }),
  snippetCompletion("> ${citação}", { label: "Citação" }),
  snippetCompletion("[${texto}](${url})", { label: "Link" }),
  snippetCompletion("![${descrição}](${url})", { label: "Imagem" }),
  snippetCompletion("# ${título}", { label: "Cabeçalho 1" }),
  snippetCompletion("## ${título}", { label: "Cabeçalho 2" }),
  snippetCompletion("### ${título}", { label: "Cabeçalho 3" }),
  snippetCompletion("---", { label: "Linha horizontal" }),
];

const CODE_BLOCK_NODES = new Set(["FencedCode", "CodeBlock"]);

function isInsideCodeBlock(context: CompletionContext, pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(pos, -1);
  while (node) {
    if (CODE_BLOCK_NODES.has(node.name)) return true;
    node = node.parent;
  }
  return false;
}

/** Fonte de completions do menu `/`: só dispara no início de uma linha
 * (ignorando espaços) e nunca dentro de um bloco de código com fence — evita
 * falsos positivos como "e/ou" no meio de texto ou "/usr/bin/env" dentro de
 * um script colado num fence.
 *
 * `from` inclui o próprio `/` (é removido junto do snippet ao aceitar), mas
 * isso significa que o texto padrão de filtro do CM6 (`sliceDoc(from, to)`,
 * que sempre começaria com "/") nunca bateria com nenhum label — por isso o
 * filtro é feito manualmente aqui (`filter: false`) contra o texto digitado
 * *depois* do `/`, em vez de delegar pro matcher default da lib. */
export function slashCommandSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/\/\S*/);
  if (!word) return null;

  const line = context.state.doc.lineAt(word.from);
  const prefix = line.text.slice(0, word.from - line.from);
  if (prefix.trim() !== "") return null;

  if (isInsideCodeBlock(context, word.from)) return null;

  const query = context.state.sliceDoc(word.from + 1, word.to).toLowerCase();
  const options = query
    ? SLASH_COMMANDS.filter((command) => command.label.toLowerCase().includes(query))
    : SLASH_COMMANDS;

  return { from: word.from, options, filter: false };
}

export const slashMenu: Extension = autocompletion({ override: [slashCommandSource], icons: false });
