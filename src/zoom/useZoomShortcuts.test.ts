import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useZoomShortcuts } from "./useZoomShortcuts";
import { useZoomStore } from "./zoomStore";

function fireKeydown(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

describe("useZoomShortcuts", () => {
  beforeEach(() => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  });

  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    useZoomStore.setState({
      zoomIn: vi.fn().mockResolvedValue(undefined),
      zoomOut: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("Cmd+Shift+= (chega como '+') chama zoomIn", () => {
    renderHook(() => useZoomShortcuts());
    fireKeydown({ key: "+", metaKey: true, shiftKey: true });
    expect(useZoomStore.getState().zoomIn).toHaveBeenCalledOnce();
  });

  it("Cmd+Shift+- (chega como '_') chama zoomOut", () => {
    renderHook(() => useZoomShortcuts());
    fireKeydown({ key: "_", metaKey: true, shiftKey: true });
    expect(useZoomStore.getState().zoomOut).toHaveBeenCalledOnce();
  });

  // Regressão da regra do DECISIONS.md #24: ⌘= e ⌘- são itens do menu
  // nativo — um listener JS pra eles nunca seria alcançado de verdade (o
  // NSMenuItem intercepta antes), então não devem existir aqui.
  it("Cmd+= e Cmd- (sem Shift) NÃO disparam nada — são exclusividade do menu nativo", () => {
    renderHook(() => useZoomShortcuts());

    fireKeydown({ key: "=", metaKey: true });
    fireKeydown({ key: "-", metaKey: true });

    expect(useZoomStore.getState().zoomIn).not.toHaveBeenCalled();
    expect(useZoomStore.getState().zoomOut).not.toHaveBeenCalled();
  });

  it("ignora eventos sem Cmd ou sem Shift", () => {
    renderHook(() => useZoomShortcuts());

    fireKeydown({ key: "+", shiftKey: true });
    fireKeydown({ key: "+", metaKey: true });

    expect(useZoomStore.getState().zoomIn).not.toHaveBeenCalled();
  });

  it("fora do macOS, Ctrl+Shift++ chama zoomIn", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    renderHook(() => useZoomShortcuts());
    fireKeydown({ key: "+", ctrlKey: true, shiftKey: true });
    expect(useZoomStore.getState().zoomIn).toHaveBeenCalled();
  });
});
