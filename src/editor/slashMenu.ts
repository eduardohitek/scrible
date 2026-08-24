import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import {
  fenceLanguageSource,
  isInsideCodeBlock,
  mermaidTypeSource,
  withChainedCompletion,
} from "./fenceCompletions";

/**
 * Autocomplete grupo B (#14): menu de comandos acionado por `/` no início de
 * uma linha vazia. Cada item é um `snippetCompletion` — os tabstops `${...}`
 * cuidam do posicionamento do cursor e da navegação via Tab entre campos
 * (comportamento embutido do `snippet()` do `@codemirror/autocomplete`, sem
 * precisar de keymap próprio).
 *
 * "Bloco de código" e "Diagrama mermaid" encadeiam no autocomplete de fence
 * do grupo D (`#15`, `fenceCompletions.ts`): inserem só a abertura do fence e
 * chamam `startCompletion` para abrir, respectivamente, a lista de
 * linguagens e a lista de tipos de diagrama mermaid.
 */
const SLASH_COMMANDS: readonly Completion[] = [
  snippetCompletion("| ${Coluna 1} | ${Coluna 2} |\n| --- | --- |\n| ${dado 1} | ${dado 2} |", {
    label: "Tabela",
  }),
  withChainedCompletion({ label: "Bloco de código", apply: "```" }),
  withChainedCompletion(snippetCompletion("```mermaid\n${}\n```", { label: "Diagrama mermaid" })),
  snippetCompletion("- [ ] ${tarefa}", { label: "Lista de tarefas" }),
  snippetCompletion("> ${citação}", { label: "Citação" }),
  snippetCompletion("[${texto}](${url})", { label: "Link" }),
  snippetCompletion("![${descrição}](${url})", { label: "Imagem" }),
  snippetCompletion("# ${título}", { label: "Cabeçalho 1" }),
  snippetCompletion("## ${título}", { label: "Cabeçalho 2" }),
  snippetCompletion("### ${título}", { label: "Cabeçalho 3" }),
  snippetCompletion("---", { label: "Linha horizontal" }),
];

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

/** Extensão única de autocomplete do editor: registra as três fontes (menu
 * `/`, linguagem de fence, tipo de diagrama mermaid) no mesmo `override` —
 * `autocompletion()` não soma entre instâncias, uma segunda extensão
 * substituiria esta configuração em vez de complementá-la. */
export const editorCompletion: Extension = autocompletion({
  override: [slashCommandSource, fenceLanguageSource, mermaidTypeSource],
  icons: false,
});
