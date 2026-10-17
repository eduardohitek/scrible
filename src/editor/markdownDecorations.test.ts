import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { markdownDecorations } from "./markdownDecorations";

let view: EditorView | null = null;

function mount(doc: string, hideMarkers: boolean, cursor = 0): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [markdown({ base: markdownLanguage }), markdownDecorations(hideMarkers)],
    }),
    parent: document.body,
  });
  return view;
}

const text = (v: EditorView) => v.contentDOM.textContent;

afterEach(() => {
  view?.destroy();
  view = null;
});

describe("markdownDecorations — nível 3 (#29)", () => {
  const doc = "# Título\n\ntexto **negrito** e `código` e ~~riscado~~ e [link](https://x.com)\n\nfim";
  const endLine = doc.length;

  it("nível 2 (default): marcadores sempre visíveis", () => {
    const v = mount(doc, false, endLine);
    expect(text(v)).toBe(doc.replace(/\n/g, ""));
  });

  it("cursor fora da linha: esconde marcadores e deixa só o texto estilizado", () => {
    const v = mount(doc, true, endLine);
    expect(text(v)).toBe("Títulotexto negrito e código e riscado e linkfim");
  });

  it("cursor entra na linha: marcadores reaparecem", () => {
    const v = mount(doc, true, endLine);
    const boldLine = doc.indexOf("texto");
    v.dispatch({ selection: { anchor: boldLine + 3 } });
    expect(text(v)).toContain("**negrito**");
    expect(text(v)).toContain("[link](https://x.com)");
    expect(text(v)).not.toContain("# Título");
  });

  it("heading esconde o # e o espaço seguinte", () => {
    const v = mount(doc, true, endLine);
    expect(text(v)?.startsWith("Título")).toBe(true);
    v.dispatch({ selection: { anchor: 2 } });
    expect(text(v)?.startsWith("# Título")).toBe(true);
  });

  it("navegar por todas as posições nunca altera o documento", () => {
    const v = mount(doc, true, 0);
    for (let pos = 0; pos <= doc.length; pos++) {
      v.dispatch({ selection: { anchor: pos } });
      expect(v.state.doc.toString()).toBe(doc);
    }
  });

  it("seleção cruzando linhas revela as linhas tocadas e copia o markdown real", () => {
    const v = mount(doc, true, endLine);
    v.dispatch({ selection: EditorSelection.range(0, doc.indexOf("fim")) });
    expect(text(v)).toContain("# Título");
    expect(text(v)).toContain("**negrito**");
    const { from, to } = v.state.selection.main;
    expect(v.state.sliceDoc(from, to)).toBe(doc.slice(0, doc.indexOf("fim")));
  });

  it("não esconde fences, imagens nem links por referência", () => {
    const special = "```js\ncode\n```\n\n![alt](img.png)\n\n[ref][1]\n\nfim";
    const v = mount(special, true, special.length);
    expect(text(v)).toContain("```js");
    expect(text(v)).toContain("![alt](img.png)");
    expect(text(v)).toContain("[ref][1]");
  });

  it("título de link multi-linha é escondido por linha, sem desativar o plugin", () => {
    const multi = '[link](/url "first\nsecond")\n\nfim';
    const v = mount(multi, true, multi.length);
    expect(text(v)).not.toMatch(/[[\]()"]|first|second|url/);
    expect(v.state.doc.toString()).toBe(multi);
  });
});
