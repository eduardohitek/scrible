import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLayoutShortcuts } from "./useLayoutShortcuts";
import { useLayoutStore } from "./layoutStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

function fireKeydown(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

describe("useLayoutShortcuts", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      splitRatio: 0.5,
      previewVisible: true,
      togglePreview: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("Cmd+Shift+P chama togglePreview", () => {
    renderHook(() => useLayoutShortcuts());
    fireKeydown({ key: "P", metaKey: true, shiftKey: true });
    expect(useLayoutStore.getState().togglePreview).toHaveBeenCalled();
  });

  it("sem Shift, Cmd+P é ignorado", () => {
    renderHook(() => useLayoutShortcuts());
    fireKeydown({ key: "p", metaKey: true });
    expect(useLayoutStore.getState().togglePreview).not.toHaveBeenCalled();
  });

  it("sem Cmd, Shift+P é ignorado", () => {
    renderHook(() => useLayoutShortcuts());
    fireKeydown({ key: "P", shiftKey: true });
    expect(useLayoutStore.getState().togglePreview).not.toHaveBeenCalled();
  });

  it("desmontar o hook remove o listener", () => {
    const { unmount } = renderHook(() => useLayoutShortcuts());
    unmount();
    fireKeydown({ key: "P", metaKey: true, shiftKey: true });
    expect(useLayoutStore.getState().togglePreview).not.toHaveBeenCalled();
  });
});
