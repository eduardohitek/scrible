import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScrollSync } from "./useScrollSync";
import type { EditorPaneHandle } from "../editor/EditorPane";
import type { PreviewPaneHandle } from "../preview/PreviewPane";

function makeEditorHandle(scrollDOM: HTMLElement): EditorPaneHandle {
  return {
    getScrollDOM: () => scrollDOM,
    getTopVisibleLine: () => 0,
    scrollToLine: vi.fn(),
  };
}

function makePreviewHandle(container: HTMLDivElement): PreviewPaneHandle {
  return { getContainer: () => container };
}

describe("useScrollSync", () => {
  it("anexa os listeners assim que tabId deixa de ser null, sem esperar outra troca de enabled", () => {
    // Regressão: no boot real do app (`App.tsx`), `activeTabId` começa `null`
    // (bootstrap assíncrono do workspace) — `EditorPane` só monta depois
    // disso, então `editorRef.current` ainda é `null` no primeiro mount de
    // `useScrollSync`. Sem `tabId` nas deps do efeito, o early-return por
    // handle ausente era permanente: a sincronização nunca chegava a
    // funcionar, mesmo depois da aba real existir.
    const editorScrollDOM = document.createElement("div");
    const previewContainer = document.createElement("div");
    const addSpyEditor = vi.spyOn(editorScrollDOM, "addEventListener");
    const addSpyPreview = vi.spyOn(previewContainer, "addEventListener");

    const editorRef: { current: EditorPaneHandle | null } = { current: null };
    const previewRef = { current: makePreviewHandle(previewContainer) };

    const { rerender } = renderHook<void, { tabId: string | null }>(
      ({ tabId }) => useScrollSync(editorRef, previewRef, "linha única", true, tabId),
      { initialProps: { tabId: null } },
    );

    expect(addSpyEditor).not.toHaveBeenCalled();

    // Bootstrap resolve: EditorPane monta e passa a expor a handle.
    editorRef.current = makeEditorHandle(editorScrollDOM);
    rerender({ tabId: "tab-1" });

    expect(addSpyEditor).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(addSpyPreview).toHaveBeenCalledWith("scroll", expect.any(Function));
  });

  it("não anexa listeners quando o preview está oculto (enabled = false)", () => {
    const editorScrollDOM = document.createElement("div");
    const previewContainer = document.createElement("div");
    const addSpyEditor = vi.spyOn(editorScrollDOM, "addEventListener");

    const editorRef = { current: makeEditorHandle(editorScrollDOM) };
    const previewRef = { current: makePreviewHandle(previewContainer) };

    renderHook(() => useScrollSync(editorRef, previewRef, "linha única", false, "tab-1"));

    expect(addSpyEditor).not.toHaveBeenCalled();
  });

  it("rolar o editor rola o preview proporcionalmente", () => {
    const editorScrollDOM = document.createElement("div");
    const previewContainer = document.createElement("div");

    // `getBoundingClientRect`/`scrollHeight` reais não existem em jsdom —
    // stub mínimo pra simular um bloco marcado a meio caminho do preview.
    const block = document.createElement("p");
    block.dataset.sourceLine = "10";
    previewContainer.appendChild(block);
    vi.spyOn(previewContainer, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(block, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
    Object.defineProperty(previewContainer, "scrollHeight", { value: 400, configurable: true });

    const editorHandle = makeEditorHandle(editorScrollDOM);
    vi.spyOn(editorHandle, "getTopVisibleLine").mockReturnValue(5);

    const editorRef = { current: editorHandle };
    const previewRef = { current: makePreviewHandle(previewContainer) };

    renderHook(() =>
      // 20 linhas no total: âncoras sintéticas {0,0} e {20,400} + o bloco {10,100}.
      useScrollSync(editorRef, previewRef, Array.from({ length: 20 }).join("\n"), true, "tab-1"),
    );

    editorScrollDOM.dispatchEvent(new Event("scroll"));

    // Linha 5 fica na metade do caminho entre a âncora sintética inicial
    // (0, 0) e o bloco marcado (10, 100) → offset 50.
    expect(previewContainer.scrollTop).toBe(50);
  });
});
