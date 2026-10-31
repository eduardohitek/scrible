import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { createPathCompletionSource } from "./pathCompletions";
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

/** Esqueleto OpenAPI 3.1 mínimo e válido (#100): info, 1 path com 1 operação e
 * 1 resposta. Os tabstops cobrem os campos que todo documento muda; o teste
 * garante que o texto inserido passa no parser do preview (#96). */
export const OPENAPI_SKELETON = `\`\`\`openapi
openapi: 3.1.0
info:
  title: \${Minha API}
  version: \${1.0.0}
paths:
  \${/recursos}:
    get:
      summary: \${Lista os recursos}
      responses:
        '200':
          description: \${OK}
\`\`\``;

const SLASH_COMMANDS: readonly Completion[] = [
  snippetCompletion("| ${Coluna 1} | ${Coluna 2} |\n| --- | --- |\n| ${dado 1} | ${dado 2} |", {
    label: "Tabela",
  }),
  withChainedCompletion({ label: "Bloco de código", apply: "```" }),
  withChainedCompletion(snippetCompletion("```mermaid\n${}\n```", { label: "Diagrama mermaid" })),
  snippetCompletion(OPENAPI_SKELETON, { label: "Especificação OpenAPI" }),
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

/** Extensão única de autocomplete do editor: registra as fontes (menu
 * `/`, linguagem de fence, tipo de diagrama mermaid e caminhos) no mesmo `override` —
 * `autocompletion()` não soma entre instâncias, uma segunda extensão
 * substituiria esta configuração em vez de complementá-la. */
export function createEditorCompletion(getDocumentPath: () => string | null): Extension {
  return autocompletion({
    override: [slashCommandSource, fenceLanguageSource, mermaidTypeSource, createPathCompletionSource(getDocumentPath)],
    icons: false,
  });
}

export const editorCompletion: Extension = createEditorCompletion(() => null);
