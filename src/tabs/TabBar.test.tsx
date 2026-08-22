import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TabBar } from "./TabBar";
import { useTabsStore } from "../store/tabsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

function threeTabs() {
  return [
    { id: "tab-1", path: "/root/a.md", title: "a.md" },
    { id: "tab-2", path: "/root/b.md", title: "b.md" },
    { id: "tab-3", path: "/root/c.md", title: "c.md" },
  ];
}

describe("TabBar", () => {
  beforeEach(() => {
    useTabsStore.setState({
      workspaceRoot: "/root",
      tabs: threeTabs(),
      activeTabId: "tab-1",
      editingTabId: null,
      openTab: vi.fn(),
      newTab: vi.fn(),
      closeTab: vi.fn().mockResolvedValue(undefined),
      setActiveTab: useTabsStore.getState().setActiveTab,
      reorderTabs: vi.fn(),
      renameTab: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("clicar numa aba a ativa", () => {
    render(<TabBar />);

    fireEvent.click(screen.getByText("b.md"));

    expect(useTabsStore.getState().activeTabId).toBe("tab-2");
  });

  it("clicar no botão fechar chama closeTab sem exibir confirm()", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<TabBar />);

    fireEvent.click(screen.getByLabelText("Fechar b.md"));

    expect(useTabsStore.getState().closeTab).toHaveBeenCalledWith("tab-2");
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("duplo-clique entra em edição; Enter confirma renameTab", () => {
    render(<TabBar />);

    fireEvent.doubleClick(screen.getByText("a.md"));
    const input = screen.getByDisplayValue("a.md");
    fireEvent.change(input, { target: { value: "notas" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useTabsStore.getState().renameTab).toHaveBeenCalledWith("tab-1", "notas");
  });

  it("Escape cancela a edição sem chamar renameTab", () => {
    render(<TabBar />);

    fireEvent.doubleClick(screen.getByText("a.md"));
    const input = screen.getByDisplayValue("a.md");
    fireEvent.change(input, { target: { value: "descartado" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(useTabsStore.getState().renameTab).not.toHaveBeenCalled();
    expect(screen.getByText("a.md")).not.toBeNull();
  });

  it("arrastar uma aba para outra posição chama reorderTabs(from, to)", () => {
    render(<TabBar />);

    const tabs = screen.getAllByText(/\.md$/).map((el) => el.closest(".tab")!);
    fireEvent.dragStart(tabs[0]);
    fireEvent.dragOver(tabs[2]);
    fireEvent.drop(tabs[2]);

    expect(useTabsStore.getState().reorderTabs).toHaveBeenCalledWith(0, 2);
  });

  it('botão "+" chama newTab', () => {
    render(<TabBar />);

    fireEvent.click(screen.getByLabelText("Nova aba"));

    expect(useTabsStore.getState().newTab).toHaveBeenCalled();
  });
});
