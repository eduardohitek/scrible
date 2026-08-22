import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTabShortcuts } from "./useTabShortcuts";
import { useTabsStore } from "../store/tabsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

function fireKeydown(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

describe("useTabShortcuts", () => {
  beforeEach(() => {
    useTabsStore.setState({
      workspaceRoot: "/root",
      tabs: [
        { id: "tab-1", path: "/root/a.md", title: "a.md" },
        { id: "tab-2", path: "/root/b.md", title: "b.md" },
      ],
      activeTabId: "tab-2",
      focusTabByIndex: vi.fn(),
      focusNextTab: vi.fn(),
      focusPrevTab: vi.fn(),
    });
  });

  it("Cmd+Shift+] chama focusNextTab", () => {
    renderHook(() => useTabShortcuts());
    fireKeydown({ key: "]", metaKey: true, shiftKey: true });
    expect(useTabsStore.getState().focusNextTab).toHaveBeenCalled();
  });

  it("Cmd+Shift+[ chama focusPrevTab", () => {
    renderHook(() => useTabShortcuts());
    fireKeydown({ key: "[", metaKey: true, shiftKey: true });
    expect(useTabsStore.getState().focusPrevTab).toHaveBeenCalled();
  });

  it("Cmd+3 chama focusTabByIndex(3)", () => {
    renderHook(() => useTabShortcuts());
    fireKeydown({ key: "3", metaKey: true });
    expect(useTabsStore.getState().focusTabByIndex).toHaveBeenCalledWith(3);
  });

  it("sem Cmd, teclas são ignoradas", () => {
    renderHook(() => useTabShortcuts());
    fireKeydown({ key: "3" });
    expect(useTabsStore.getState().focusTabByIndex).not.toHaveBeenCalled();
  });

  it("desmontar o hook remove o listener", () => {
    const { unmount } = renderHook(() => useTabShortcuts());
    unmount();
    fireKeydown({ key: "3", metaKey: true });
    expect(useTabsStore.getState().focusTabByIndex).not.toHaveBeenCalled();
  });
});
