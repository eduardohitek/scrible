import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { closeSearchPanel, findNext, findPrevious, openSearchPanel, replaceAll, replaceNext, SearchQuery, searchKeymap, setSearchQuery } from "@codemirror/search";
import { searchExtensions } from "./searchExtensions";

function createView(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [keymap.of([...defaultKeymap, ...searchKeymap]), searchExtensions],
  });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({ state, parent });
}

function setQuery(view: EditorView, spec: ConstructorParameters<typeof SearchQuery>[0]) {
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery(spec)) });
}

// jsdom não expõe `navigator.platform` como "Mac..." (fica vazio), então a
// detecção de plataforma do CodeMirror trata "Mod" como Ctrl aqui, não Meta
// — só nesse ambiente de teste. No app real (macOS via Tauri/WebKit), "Mod"
// resolve para Cmd normalmente; verificado manualmente via `mise run dev`.
function dispatchModKeydown(target: EventTarget, key: string, extra: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra }));
}

describe("searchExtensions", () => {
  let view: EditorView;

  afterEach(() => {
    view.destroy();
  });

  it("Cmd+F abre o painel de busca no topo do editor", () => {
    view = createView("foo bar foo");

    dispatchModKeydown(view.contentDOM, "f");

    expect(view.dom.querySelector(".cm-search")).not.toBeNull();
  });

  it("digitar destaca todas as ocorrências", () => {
    view = createView("foo bar foo baz foo");
    openSearchPanel(view);

    setQuery(view, { search: "foo" });

    expect(view.dom.querySelectorAll(".cm-searchMatch").length).toBe(3);
  });

  it("Enter/Shift-Enter (findNext/findPrevious) navegam entre ocorrências", () => {
    view = createView("foo bar foo");
    setQuery(view, { search: "foo" });

    findNext(view);
    const first = view.state.selection.main.from;
    findNext(view);
    const second = view.state.selection.main.from;
    expect(second).not.toBe(first);

    findPrevious(view);
    expect(view.state.selection.main.from).toBe(first);
  });

  it("substitui uma ocorrência", () => {
    view = createView("foo bar foo");
    setQuery(view, { search: "foo", replace: "qux" });
    findNext(view);

    replaceNext(view);

    expect(view.state.doc.toString()).toBe("qux bar foo");
  });

  it("substitui todas as ocorrências", () => {
    view = createView("foo bar foo");
    setQuery(view, { search: "foo", replace: "qux" });

    replaceAll(view);

    expect(view.state.doc.toString()).toBe("qux bar qux");
  });

  it("Esc fecha o painel e devolve o foco ao editor", () => {
    view = createView("foo");
    dispatchModKeydown(view.contentDOM, "f");
    expect(view.dom.querySelector(".cm-search")).not.toBeNull();

    closeSearchPanel(view);

    expect(view.dom.querySelector(".cm-search")).toBeNull();
  });

  it("Cmd+Option+F abre o painel com foco no campo de substituição", () => {
    view = createView("foo");

    dispatchModKeydown(view.contentDOM, "f", { altKey: true });

    const replaceField = view.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]');
    expect(replaceField).not.toBeNull();
    expect(document.activeElement).toBe(replaceField);
  });
});
