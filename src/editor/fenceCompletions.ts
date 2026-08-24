import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

/**
 * Autocomplete grupo D (#15): dois níveis de sugestão em blocos de código com
 * fence. O primeiro dispara ao digitar ` ``` ` e sugere a linguagem; o
 * segundo, restrito a um bloco ` ```mermaid ` ainda vazio, sugere o tipo de
 * diagrama. Os dois níveis se encadeiam via `startCompletion` — o CM6 não
 * reabre o menu sozinho depois de aceitar uma opção (a auto-ativação só
 * reage a `userEvent: "input.type"`; inserir uma completion usa
 * `"input.complete"`), então o encadeamento precisa ser explícito.
 */

export const FENCE_LANGUAGES = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "dockerfile",
  "go",
  "graphql",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "markdown",
  "mermaid",
  "php",
  "python",
  "ruby",
  "rust",
  "sql",
  "swift",
  "typescript",
  "yaml",
] as const;

export const MERMAID_SKELETONS: Record<string, string> = {
  flowchart: `flowchart TD
    A[Início] --> B{Decisão}
    B -->|Sim| C[Ação]
    B -->|Não| D[Fim]`,
  sequenceDiagram: `sequenceDiagram
    participant A as Cliente
    participant B as Servidor
    A->>B: Requisição
    B-->>A: Resposta`,
  classDiagram: `classDiagram
    class Animal {
        +String nome
        +fazerSom()
    }
    class Cachorro {
        +latir()
    }
    Animal <|-- Cachorro`,
  "stateDiagram-v2": `stateDiagram-v2
    [*] --> Ocioso
    Ocioso --> Executando
    Executando --> Ocioso
    Executando --> [*]`,
  gantt: `gantt
    title Cronograma
    dateFormat YYYY-MM-DD
    section Fase 1
    Tarefa 1 :a1, 2024-01-01, 5d
    Tarefa 2 :after a1, 3d`,
  erDiagram: `erDiagram
    CLIENTE ||--o{ PEDIDO : realiza
    PEDIDO ||--|{ ITEM : contém`,
  pie: `pie title Distribuição
    "Categoria A" : 40
    "Categoria B" : 35
    "Categoria C" : 25`,
};

const CODE_BLOCK_NODES = new Set(["FencedCode", "CodeBlock"]);

/** Reaproveitado por `slashMenu.ts` para suprimir o menu `/` dentro de
 * qualquer bloco de código com fence. */
export function isInsideCodeBlock(context: CompletionContext, pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(pos, -1);
  while (node) {
    if (CODE_BLOCK_NODES.has(node.name)) return true;
    node = node.parent;
  }
  return false;
}

/** Um ` ``` ` cujo início de linha já está dentro de um `FencedCode`/
 * `CodeBlock` que começou numa linha anterior é o marcador de *fechamento*
 * desse bloco, não a abertura de um novo — não deve sugerir linguagem. */
function isClosingFence(context: CompletionContext, lineStart: number): boolean {
  let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(lineStart, -1);
  while (node) {
    if (CODE_BLOCK_NODES.has(node.name) && node.from < lineStart) return true;
    node = node.parent;
  }
  return false;
}

function findEnclosingFencedCode(context: CompletionContext, pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(pos, -1);
  while (node) {
    if (node.name === "FencedCode") return node;
    node = node.parent;
  }
  return null;
}

/** Embrulha o `apply` de uma completion para, depois de inseri-la, abrir o
 * próximo menu de completion na nova posição do cursor — é assim que o
 * segundo nível (linguagem `mermaid` → tipo de diagrama) se conecta ao
 * primeiro. */
export function withChainedCompletion(completion: Completion): Completion {
  const original = completion.apply;
  return {
    ...completion,
    apply: (view: EditorView, comp: Completion, from: number, to: number) => {
      if (typeof original === "function") {
        original(view, comp, from, to);
      } else {
        const insert = typeof original === "string" ? original : comp.label;
        view.dispatch(
          view.state.update({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
          }),
        );
      }
      startCompletion(view);
    },
  };
}

function languageCompletion(lang: string): Completion {
  // "mermaid" encadeia no menu de tipos (2º nível) logo em seguida — o corpo
  // fica vazio (campo `${}` sem nome) em vez do placeholder `${conteúdo}`
  // das demais linguagens, já que será substituído pelo esqueleto do tipo
  // escolhido.
  const template = lang === "mermaid" ? `${lang}\n\${}\n\`\`\`` : `${lang}\n\${conteúdo}\n\`\`\``;
  const snippet = snippetCompletion(template, { label: lang });
  return lang === "mermaid" ? withChainedCompletion(snippet) : snippet;
}

const FENCE_LANGUAGE_COMPLETIONS: readonly Completion[] = FENCE_LANGUAGES.map(languageCompletion);

/** Fonte de completions do 1º nível: dispara ao digitar ` ``` ` no início de
 * uma linha (ignorando indentação), sugerindo a lista de linguagens. `from`
 * fica logo após as três crases — diferente do menu `/` da `#14`, aqui não é
 * preciso `filter: false`: como o texto digitado depois das crases já é o
 * próprio prefixo da linguagem, o matcher fuzzy default do CM6 funciona sem
 * ajuda. */
export function fenceLanguageSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/```[A-Za-z0-9+#-]*/);
  if (!word) return null;

  const line = context.state.doc.lineAt(word.from);
  const prefix = line.text.slice(0, word.from - line.from);
  if (prefix.trim() !== "") return null;

  if (isClosingFence(context, line.from)) return null;

  return { from: word.from + 3, options: [...FENCE_LANGUAGE_COMPLETIONS] };
}

/** Fonte de completions do 2º nível: só dispara dentro de um bloco
 * ` ```mermaid ` que ainda não declarou nenhum conteúdo (todas as linhas
 * entre a abertura do fence e o cursor estão em branco) — uma vez que o
 * diagrama já tem uma primeira linha real, o menu nunca mais interrompe a
 * edição. */
export function mermaidTypeSource(context: CompletionContext): CompletionResult | null {
  const fence = findEnclosingFencedCode(context, context.pos);
  if (!fence) return null;

  const doc = context.state.doc;
  const openLine = doc.lineAt(fence.from);
  if (!/^\s*`{3,}\s*mermaid\b/i.test(openLine.text)) return null;

  const cursorLine = doc.lineAt(context.pos);
  if (cursorLine.number === openLine.number) return null;

  for (let lineNo = openLine.number + 1; lineNo < cursorLine.number; lineNo++) {
    if (doc.line(lineNo).text.trim() !== "") return null;
  }

  const word = context.matchBefore(/[A-Za-z0-9-]*/);
  if (!word) return null;
  const untypedPrefix = cursorLine.text.slice(0, word.from - cursorLine.from);
  if (untypedPrefix.trim() !== "") return null;

  const query = word.text.toLowerCase();
  const options: Completion[] = Object.keys(MERMAID_SKELETONS)
    .filter((type) => !query || type.toLowerCase().includes(query))
    .map((type) => ({ label: type, apply: MERMAID_SKELETONS[type] }));
  if (options.length === 0) return null;

  return { from: word.from, options };
}
