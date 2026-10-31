import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CompletionContext, currentCompletions, type Completion } from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import mermaid from "mermaid";
import { MERMAID_SKELETONS, fenceLanguageSource, mermaidTypeSource } from "./fenceCompletions";
import { editorCompletion } from "./slashMenu";

function makeState(doc: string, pos: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(pos),
    extensions: [markdown({ base: markdownLanguage })],
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("fenceLanguageSource", () => {
  it("sugere linguagens ao digitar ``` no início de uma linha", () => {
    const state = makeState("```", 3);
    const result = fenceLanguageSource(new CompletionContext(state, 3, false));

    expect(result).not.toBeNull();
    expect(result?.from).toBe(3);
    const labels = result?.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["javascript", "python", "mermaid", "yaml"]));
  });

  it("sugere linguagens com ``` precedido só de espaços (indentação)", () => {
    const state = makeState("  ```", 5);
    const result = fenceLanguageSource(new CompletionContext(state, 5, false));

    expect(result).not.toBeNull();
    expect(result?.from).toBe(5);
  });

  it("não abre com texto antes do ``` na mesma linha", () => {
    const state = makeState("texto ```", 9);
    const result = fenceLanguageSource(new CompletionContext(state, 9, false));

    expect(result).toBeNull();
  });

  it("não abre no ``` de fechamento de um bloco já aberto", () => {
    const doc = "```bash\ncódigo\n```";
    const pos = doc.length;
    const state = makeState(doc, pos);
    const result = fenceLanguageSource(new CompletionContext(state, pos, false));

    expect(result).toBeNull();
  });

  it("devolve a lista completa (sem filtro próprio) — filtragem é delegada ao matcher default do CM6", () => {
    const state = makeState("```py", 5);
    const result = fenceLanguageSource(new CompletionContext(state, 5, false));

    // Diferente de `slashCommandSource` (#14, `filter: false` por causa do
    // `from` incluir o `/`), aqui `from` já exclui as crases — o filtro
    // fuzzy default do CM6 funciona sem ajuda. A filtragem de fato acontece
    // no pipeline completo, coberta pelo teste de integração abaixo.
    expect(result?.options.length).toBe(26);
    expect(result?.options.map((o) => o.label)).toContain("python");
    expect(result?.options.map((o) => o.label)).toEqual(expect.arrayContaining(["openapi", "swagger"]));
  });
});

describe("mermaidTypeSource", () => {
  it("sugere os 7 tipos num bloco ```mermaid ainda vazio", () => {
    const doc = "```mermaid\n\n```";
    const pos = doc.indexOf("\n\n") + 1;
    const state = makeState(doc, pos);
    const result = mermaidTypeSource(new CompletionContext(state, pos, false));

    expect(result).not.toBeNull();
    expect(result?.options.map((o) => o.label).sort()).toEqual(Object.keys(MERMAID_SKELETONS).sort());
  });

  it("não abre num bloco mermaid que já declarou o tipo", () => {
    const doc = "```mermaid\nflowchart TD\n    A --> B\n\n```";
    const pos = doc.lastIndexOf("\n\n") + 1;
    const state = makeState(doc, pos);
    const result = mermaidTypeSource(new CompletionContext(state, pos, false));

    expect(result).toBeNull();
  });

  it("não abre em bloco de outra linguagem", () => {
    const doc = "```python\n\n```";
    const pos = doc.indexOf("\n\n") + 1;
    const state = makeState(doc, pos);
    const result = mermaidTypeSource(new CompletionContext(state, pos, false));

    expect(result).toBeNull();
  });

  it("filtra os tipos pelo texto digitado", () => {
    const doc = "```mermaid\ngan\n```";
    const pos = doc.indexOf("gan") + 3;
    const state = makeState(doc, pos);
    const result = mermaidTypeSource(new CompletionContext(state, pos, false));

    expect(result?.options.map((o) => o.label)).toEqual(["gantt"]);
  });
});

describe("integração com EditorView real", () => {
  let view: EditorView;

  afterEach(() => {
    view.destroy();
  });

  function createView(doc: string): EditorView {
    const state = EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), editorCompletion],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
  }

  it("digitar ```py filtra a lista para python via matcher default do CM6", async () => {
    view = createView("");

    view.dispatch({
      changes: { from: 0, to: 0, insert: "```py" },
      selection: EditorSelection.cursor(5),
      userEvent: "input.type",
    });

    await wait(200);
    expect(currentCompletions(view.state).map((c) => c.label)).toEqual(["python"]);
  });

  it("aceitar 'mermaid' abre sozinho o menu de tipos, e aceitar um tipo insere o esqueleto", async () => {
    view = createView("");

    // Digita "```" e aceita a opção "mermaid" do 1º nível.
    view.dispatch({ changes: { from: 0, to: 0, insert: "```" }, selection: EditorSelection.cursor(3) });
    const level1 = fenceLanguageSource(new CompletionContext(view.state, 3, false));
    const mermaidOption = level1?.options.find((o) => o.label === "mermaid");
    expect(mermaidOption?.apply).toBeTypeOf("function");
    (mermaidOption!.apply as (view: EditorView, completion: Completion, from: number, to: number) => void)(
      view,
      mermaidOption!,
      level1!.from,
      3,
    );

    expect(view.state.doc.toString()).toBe("```mermaid\n\n```");

    // O `startCompletion` encadeado pelo `apply` acima é assíncrono (debounce
    // interno do plugin de autocomplete, ver DECISIONS.md #15) — aguarda o
    // menu de tipos abrir de fato na UI do CodeMirror antes de checar.
    await wait(150);
    const openLabels = currentCompletions(view.state).map((c) => c.label);
    expect(openLabels.sort()).toEqual(Object.keys(MERMAID_SKELETONS).sort());

    // Aceita "gantt" reaproveitando a mesma fonte (a inserção em si já está
    // coberta pelos testes headless acima).
    const cursor = view.state.selection.main.head;
    const level2 = mermaidTypeSource(new CompletionContext(view.state, cursor, false));
    const ganttOption = level2?.options.find((o) => o.label === "gantt");
    expect(ganttOption).toBeDefined();
    view.dispatch({ changes: { from: level2!.from, to: cursor, insert: MERMAID_SKELETONS.gantt } });

    expect(view.state.doc.toString()).toBe(`\`\`\`mermaid\n${MERMAID_SKELETONS.gantt}\n\`\`\``);
  });
});

describe("MERMAID_SKELETONS", () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false });
  });

  it.each(Object.entries(MERMAID_SKELETONS))("o esqueleto de %s é sintaticamente válido", async (_type, skeleton) => {
    await expect(mermaid.parse(skeleton)).resolves.toBeTruthy();
  });
});
