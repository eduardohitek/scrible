import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useDocumentStore } from "../store/documentStore";
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
  let resize: () => void;
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function overflowBar() {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
  }
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
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
  it("mostra o botão somente com overflow e atualiza ao redimensionar", () => {
    render(<TabBar />);
    expect(screen.queryByLabelText("Todas as abas")).toBeNull();
    overflowBar();
    act(() => resize());
    expect(screen.getByLabelText("Todas as abas")).not.toBeNull();
    vi.restoreAllMocks();
    act(() => resize());
    expect(screen.queryByLabelText("Todas as abas")).toBeNull();
  });

  it("converte roda vertical e preserva o gesto horizontal", () => {
    overflowBar();
    const { container } = render(<TabBar />);
    const bar = container.querySelector(".tab-bar")!;
    fireEvent.wheel(bar, { deltaY: 80 });
    expect(bar.scrollLeft).toBe(80);
    fireEvent.wheel(bar, { deltaX: 60, deltaY: 5 });
    expect(bar.scrollLeft).toBe(80);
  });

  it("revela a aba ativa quando o store muda, inclusive na restauração", () => {
    overflowBar();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const left = this.dataset.tabId === "tab-3" ? 350 : 0;
      return { left, right: left + 200 } as DOMRect;
    });
    const { container } = render(<TabBar />);
    const bar = container.querySelector(".tab-bar")!;
    act(() => useTabsStore.setState({ activeTabId: "tab-3" }));
    expect(bar.scrollLeft).toBe(350);
  });

  it("lista nome e pasta, marca a ativa, seleciona e fecha", () => {
    overflowBar();
    render(<TabBar />);
    fireEvent.click(screen.getByLabelText("Todas as abas"));
    expect(screen.getAllByText("/root")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /✓ a.md/ }).getAttribute("aria-current")).toBe(
      "page",
    );
    fireEvent.click(screen.getByRole("button", { name: /c.md.*root/ }));
    expect(useTabsStore.getState().activeTabId).toBe("tab-3");
    expect(screen.queryByLabelText("Abas abertas")).toBeNull();
  });

  it("fecha com Escape e clique fora", () => {
    overflowBar();
    render(<TabBar />);
    fireEvent.click(screen.getByLabelText("Todas as abas"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("Abas abertas")).toBeNull();
    fireEvent.click(screen.getByLabelText("Todas as abas"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByLabelText("Abas abertas")).toBeNull();
  });
  it("atualiza a marca dirty enquanto a lista está aberta", () => {
    overflowBar();
    useDocumentStore.setState({ documents: {} });
    render(<TabBar />);
    fireEvent.click(screen.getByLabelText("Todas as abas"));
    act(() =>
      useDocumentStore.setState({
        documents: {
          "tab-2": {
            path: "/root/b.md",
            content: "",
            lastSavedMtime: null,
            status: "idle",
            dirty: true,
            conflict: null,
          },
        },
      }),
    );
    expect(screen.getByRole("button", { name: /b.md •/ })).not.toBeNull();
    act(() => useDocumentStore.setState({ documents: {} }));
    expect(screen.queryByRole("button", { name: /b.md •/ })).toBeNull();
  });
});
