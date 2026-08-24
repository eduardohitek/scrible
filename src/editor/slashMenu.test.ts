import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { slashCommandSource } from "./slashMenu";

function makeState(doc: string, pos: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(pos),
    extensions: [markdown({ base: markdownLanguage })],
  });
}

function complete(doc: string, pos: number) {
  const state = makeState(doc, pos);
  return slashCommandSource(new CompletionContext(state, pos, false));
}

/** Aplica o snippet de um item do menu como o CodeMirror faria ao aceitar a
 * completion — sem precisar de um `EditorView` real, já que `snippet()` só
 * usa `editor.state`/`editor.dispatch` (ver DECISIONS.md #14). */
function applyCompletion(doc: string, pos: number, label: string): EditorState {
  const state = makeState(doc, pos);
  const result = slashCommandSource(new CompletionContext(state, pos, false));
  if (!result) throw new Error("menu não abriu");
  const option = result.options.find((o) => o.label === label);
  if (!option?.apply || typeof option.apply !== "function") throw new Error(`item "${label}" sem apply`);

  let nextState = state;
  const dispatch = (tr: Transaction) => {
    nextState = tr.state;
  };
  option.apply({ state, dispatch } as never, option, result.from, pos);
  return nextState;
}

describe("slashCommandSource", () => {
  it("abre o menu ao digitar / no início de uma linha vazia", () => {
    const result = complete("/", 1);

    expect(result).not.toBeNull();
    expect(result?.from).toBe(0);
    const labels = result?.options.map((o) => o.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Tabela",
        "Bloco de código",
        "Diagrama mermaid",
        "Lista de tarefas",
        "Citação",
        "Link",
        "Imagem",
        "Cabeçalho 1",
        "Cabeçalho 2",
        "Cabeçalho 3",
        "Linha horizontal",
      ]),
    );
  });

  it("abre o menu com / precedido só de espaços (indentação)", () => {
    const result = complete("  /", 3);

    expect(result).not.toBeNull();
    expect(result?.from).toBe(2);
  });

  it("não abre com texto antes do / na mesma linha (ex: e/ou)", () => {
    const result = complete("e/ou", 2);

    expect(result).toBeNull();
  });

  it("não abre dentro de um bloco de código com fence", () => {
    const doc = "```bash\n/usr/bin/env\n```";
    const pos = doc.indexOf("/usr") + 1;

    const result = complete(doc, pos);

    expect(result).toBeNull();
  });

  it("filtra as opções pelo texto digitado após o /", () => {
    const result = complete("/tab", 4);

    expect(result).not.toBeNull();
    expect(result?.from).toBe(0);
    expect(result?.options.map((o) => o.label)).toEqual(["Tabela"]);
  });

  it("não filtra nada sem correspondência", () => {
    const result = complete("/xyz", 4);

    expect(result?.options).toEqual([]);
  });
});

describe("inserção dos snippets", () => {
  it("Tabela insere a estrutura com cursor no primeiro tabstop", () => {
    const next = applyCompletion("/", 1, "Tabela");

    expect(next.doc.toString()).toBe("| Coluna 1 | Coluna 2 |\n| --- | --- |\n| dado 1 | dado 2 |");
    expect(next.selection.main.from).toBe(2);
    expect(next.selection.main.to).toBe(10);
  });

  it("Bloco de código insere só a abertura do fence, cursor logo depois", () => {
    const next = applyCompletion("/", 1, "Bloco de código");

    expect(next.doc.toString()).toBe("```");
    expect(next.selection.main.from).toBe(3);
    expect(next.selection.main.to).toBe(3);
  });

  it("Diagrama mermaid insere o fence mermaid vazio, cursor no corpo", () => {
    const next = applyCompletion("/", 1, "Diagrama mermaid");

    expect(next.doc.toString()).toBe("```mermaid\n\n```");
    expect(next.selection.main.from).toBe(11);
    expect(next.selection.main.to).toBe(11);
  });

  it("Linha horizontal insere --- com o cursor ao final, sem tabstop", () => {
    const next = applyCompletion("/", 1, "Linha horizontal");

    expect(next.doc.toString()).toBe("---");
    expect(next.selection.main.from).toBe(3);
    expect(next.selection.main.to).toBe(3);
  });
});
