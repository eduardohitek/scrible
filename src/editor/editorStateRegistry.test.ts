import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import {
  discard,
  getOrCreateEditorState,
  getPosition,
  getScrollTop,
  saveEditorState,
  saveScrollTop,
  seedPosition,
  setHideMarkers,
  subscribePositions,
} from "./editorStateRegistry";

describe("editorStateRegistry", () => {
  beforeEach(() => {
    discard("tab-1");
    discard("tab-2");
  });

  it("cria um EditorState novo na primeira vez que uma aba é vista", () => {
    const state = getOrCreateEditorState("tab-1", "conteúdo inicial", () => {});
    expect(state.doc.toString()).toBe("conteúdo inicial");
  });

  it("devolve o mesmo estado cacheado quando o conteúdo já bate (sem despachar transação)", () => {
    const onChange = vi.fn();
    const first = getOrCreateEditorState("tab-1", "conteúdo", onChange);
    const second = getOrCreateEditorState("tab-1", "conteúdo", onChange);

    expect(second).toBe(first);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reconcilia o estado cacheado quando o conteúdo diverge (aba em segundo plano que mudou por fora)", () => {
    const onChange = vi.fn();
    const first = getOrCreateEditorState("tab-1", "conteúdo antigo", onChange);

    const reconciled = getOrCreateEditorState("tab-1", "conteúdo novo", onChange);

    expect(reconciled).not.toBe(first);
    expect(reconciled.doc.toString()).toBe("conteúdo novo");
    // a reconciliação atualiza um EditorState solto, sem EditorView anexado —
    // o updateListener (que dispara onChange) só roda através de um EditorView.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("saveEditorState substitui o cache, evitando reconciliação na próxima leitura", () => {
    const onChange = vi.fn();
    const state = getOrCreateEditorState("tab-1", "conteúdo", onChange);
    const updated = state.update({ changes: { from: 0, to: state.doc.length, insert: "editado" } }).state;

    saveEditorState("tab-1", updated);

    const fetched = getOrCreateEditorState("tab-1", "editado", onChange);
    expect(fetched).toBe(updated);
  });

  it("saveScrollTop/getScrollTop fazem round-trip; default é 0", () => {
    expect(getScrollTop("tab-1")).toBe(0);
    saveScrollTop("tab-1", 240);
    expect(getScrollTop("tab-1")).toBe(240);
  });

  it("discard limpa estado e scroll cacheados de uma aba", () => {
    const onChange = vi.fn();
    getOrCreateEditorState("tab-1", "conteúdo", onChange);
    saveScrollTop("tab-1", 100);

    discard("tab-1");

    expect(getScrollTop("tab-1")).toBe(0);
    const fresh = getOrCreateEditorState("tab-1", "outro conteúdo", onChange);
    expect(fresh.doc.toString()).toBe("outro conteúdo");
  });

  it("abas diferentes têm estados independentes", () => {
    const state1 = getOrCreateEditorState("tab-1", "aba 1", () => {});
    const state2 = getOrCreateEditorState("tab-2", "aba 2", () => {});

    expect(state1.doc.toString()).toBe("aba 1");
    expect(state2.doc.toString()).toBe("aba 2");
  });
});

describe("posição para a sessão (#9)", () => {
  it("seedPosition define o cursor inicial do EditorState criado depois", () => {
    discard("tab-seed");
    seedPosition("tab-seed", 4, 77);
    const state = getOrCreateEditorState("tab-seed", "abcdefgh", () => {});
    expect(state.selection.main.head).toBe(4);
    expect(getPosition("tab-seed")).toEqual({ cursorPos: 4, scrollTop: 77 });
    discard("tab-seed");
  });

  it("limita o cursor semeado ao tamanho do documento", () => {
    discard("tab-seed");
    seedPosition("tab-seed", 999, 0);
    const state = getOrCreateEditorState("tab-seed", "abc", () => {});
    expect(state.selection.main.head).toBe(3);
    discard("tab-seed");
  });

  it("acompanha o cursor movido num EditorView real", () => {
    discard("tab-seed");
    const view = new EditorView({ state: getOrCreateEditorState("tab-seed", "abcdef", () => {}) });
    view.dispatch({ selection: { anchor: 5 } });
    expect(getPosition("tab-seed").cursorPos).toBe(5);
    view.destroy();
    discard("tab-seed");
  });

  it("notifica assinantes quando o scroll é salvo", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePositions(listener);
    saveScrollTop("tab-seed", 10);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    saveScrollTop("tab-seed", 11);
    expect(listener).toHaveBeenCalledTimes(1);
    discard("tab-seed");
  });

  it("aba em segundo plano acompanha o nível de preview inline escolhido enquanto não estava montada (#29)", () => {
    setHideMarkers(false);
    const background = getOrCreateEditorState("tab-1", "**negrito**", () => {});
    expect(background.doc.toString()).toBe("**negrito**");

    setHideMarkers(true);
    const synced = getOrCreateEditorState("tab-1", "**negrito**", () => {});
    // Estado novo (compartment reconfigurado), documento intacto e histórico preservado.
    expect(synced).not.toBe(background);
    expect(synced.doc.toString()).toBe("**negrito**");
    expect(getOrCreateEditorState("tab-1", "**negrito**", () => {})).toBe(synced);

    setHideMarkers(false);
  });
});
