import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  discard,
  getOrCreateEditorState,
  getScrollTop,
  saveEditorState,
  saveScrollTop,
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
