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

// `root` precisa ser um ancestral real de `editorScrollDOM`/`previewContainer`
// no DOM — o sync usa delegação via fase de *capture*, que só entrega o
// evento a um listener anexado num ancestral verdadeiro do alvo (mesmo
// "scroll" não fazendo bubbling).
function makeTree() {
  const root = document.createElement("div");
  const editorScrollDOM = document.createElement("div");
  const previewContainer = document.createElement("div");
  root.appendChild(editorScrollDOM);
  root.appendChild(previewContainer);
  return { root, editorScrollDOM, previewContainer };
}

describe("useScrollSync", () => {
  it("anexa um único listener delegado no container estável, mesmo se a handle do editor ainda não existir", () => {
    // Regressão de #20: no boot real do app, `activeTabId` começa `null`
    // (bootstrap assíncrono do workspace) — `EditorPane` só monta depois
    // disso. Com delegação num ancestral estável (nunca destruído), o
    // listener não precisa esperar a handle existir pra ser útil: ele só
    // resolve a handle *dentro* do evento, então funciona assim que a
    // handle aparecer, sem precisar re-anexar nada.
    const { root, editorScrollDOM } = makeTree();
    const addSpy = vi.spyOn(root, "addEventListener");

    const editorRef: { current: EditorPaneHandle | null } = { current: null };
    const previewRef: { current: PreviewPaneHandle | null } = { current: null };
    const containerRef = { current: root };

    renderHook(() => useScrollSync(containerRef, editorRef, previewRef, "linha única", true));

    expect(addSpy).toHaveBeenCalledWith("scroll", expect.any(Function), true);

    // Não deveria lançar mesmo sem nenhuma handle ainda pronta.
    expect(() => editorScrollDOM.dispatchEvent(new Event("scroll"))).not.toThrow();
  });

  it("sobrevive à troca do elemento de scroll do editor (StrictMode remonta o EditorView)", () => {
    // Regressão do bug real reportado pelo usuário: sob StrictMode, o
    // primeiro mount de EditorPane cria e destrói um EditorView (e seu
    // scrollDOM) antes de criar o definitivo. Uma abordagem que capturasse
    // `getScrollDOM()` uma única vez no setup do efeito grudaria no
    // elemento morto. Como a handle é resolvida a cada evento, trocar o
    // elemento que a handle expõe (sem re-executar o efeito) já basta pro
    // próximo scroll ser reconhecido.
    const { root, previewContainer } = makeTree();
    const staleScrollDOM = document.createElement("div"); // nunca inserido em `root`
    const liveScrollDOM = document.createElement("div");
    root.appendChild(liveScrollDOM);

    const editorRef: { current: EditorPaneHandle | null } = { current: makeEditorHandle(staleScrollDOM) };
    const previewRef = { current: makePreviewHandle(previewContainer) };
    const containerRef = { current: root };

    renderHook(() => useScrollSync(containerRef, editorRef, previewRef, "linha única", true));

    // A handle agora aponta pro elemento vivo, sem o efeito rodar de novo.
    editorRef.current = makeEditorHandle(liveScrollDOM);

    expect(() => liveScrollDOM.dispatchEvent(new Event("scroll"))).not.toThrow();
  });

  it("não anexa listener quando o preview está oculto (enabled = false)", () => {
    const { root } = makeTree();
    const addSpy = vi.spyOn(root, "addEventListener");

    const editorRef = { current: makeEditorHandle(document.createElement("div")) };
    const previewRef = { current: makePreviewHandle(document.createElement("div")) };
    const containerRef = { current: root };

    renderHook(() => useScrollSync(containerRef, editorRef, previewRef, "linha única", false));

    expect(addSpy).not.toHaveBeenCalled();
  });

  it("rolar o editor rola o preview proporcionalmente", () => {
    const { root, editorScrollDOM, previewContainer } = makeTree();

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
    const containerRef = { current: root };

    renderHook(() =>
      // 20 linhas no total: âncoras sintéticas {0,0} e {20,400} + o bloco {10,100}.
      useScrollSync(containerRef, editorRef, previewRef, Array.from({ length: 20 }).join("\n"), true),
    );

    editorScrollDOM.dispatchEvent(new Event("scroll"));

    // Linha 5 fica na metade do caminho entre a âncora sintética inicial
    // (0, 0) e o bloco marcado (10, 100) → offset 50.
    expect(previewContainer.scrollTop).toBe(50);
  });

  it("rolar o preview rola o editor (chama scrollToLine)", () => {
    const { root, editorScrollDOM, previewContainer } = makeTree();

    const block = document.createElement("p");
    block.dataset.sourceLine = "10";
    previewContainer.appendChild(block);
    vi.spyOn(previewContainer, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(block, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
    Object.defineProperty(previewContainer, "scrollHeight", { value: 400, configurable: true });
    Object.defineProperty(previewContainer, "scrollTop", { value: 50, configurable: true });

    const editorHandle = makeEditorHandle(editorScrollDOM);
    const editorRef = { current: editorHandle };
    const previewRef = { current: makePreviewHandle(previewContainer) };
    const containerRef = { current: root };

    renderHook(() =>
      useScrollSync(containerRef, editorRef, previewRef, Array.from({ length: 20 }).join("\n"), true),
    );

    previewContainer.dispatchEvent(new Event("scroll"));

    // `getPreviewAnchors` converte o rect (viewport-relative) do bloco em
    // coordenada de conteúdo somando `scrollTop` — com scrollTop=50, o bloco
    // marcado (rect.top=100) vira a âncora {line: 10, top: 150}. Consultar
    // offset 50 entre as âncoras {0,0} e {10,150} dá linha 50/150*10 = 10/3.
    expect(editorHandle.scrollToLine).toHaveBeenCalledWith(expect.closeTo(10 / 3, 10));
  });
});
