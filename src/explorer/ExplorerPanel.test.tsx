import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExplorerPanel } from "./ExplorerPanel";
import { useExplorerStore } from "./explorerStore";
import { useTabsStore } from "../store/tabsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  open: vi.fn(),
}));

function baseExplorerState() {
  return {
    workspaceRoot: "/root",
    visible: true,
    width: 240,
    expandedDirs: new Set<string>(),
    entriesByDir: {
      "/root": [
        { name: "pasta", isDir: true },
        { name: "nota.md", isDir: false },
      ],
    },
    toggleDir: vi.fn().mockResolvedValue(undefined),
    setWidth: vi.fn().mockResolvedValue(undefined),
    createFile: vi.fn().mockResolvedValue(undefined),
    createFolder: vi.fn().mockResolvedValue(undefined),
    renameEntry: vi.fn().mockResolvedValue(undefined),
    deleteEntry: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ExplorerPanel", () => {
  beforeEach(() => {
    useExplorerStore.setState(baseExplorerState());
    useTabsStore.setState({
      workspaceRoot: "/root",
      tabs: [],
      activeTabId: null,
      editingTabId: null,
      openTab: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("renderiza pastas antes de arquivos, refletindo a ordem já vinda do backend", () => {
    render(<ExplorerPanel />);

    expect(screen.getByText("pasta")).not.toBeNull();
    expect(screen.getByText("nota.md")).not.toBeNull();
  });

  it("clicar num arquivo abre a aba correspondente", () => {
    render(<ExplorerPanel />);

    fireEvent.click(screen.getByText("nota.md"));

    expect(useTabsStore.getState().openTab).toHaveBeenCalledWith("/root/nota.md");
  });

  it("clicar numa pasta chama toggleDir com o path completo", () => {
    render(<ExplorerPanel />);

    fireEvent.click(screen.getByText("pasta"));

    expect(useExplorerStore.getState().toggleDir).toHaveBeenCalledWith("/root/pasta");
  });

  it("pasta expandida renderiza as entradas em cache de entriesByDir", () => {
    useExplorerStore.setState({
      expandedDirs: new Set(["/root/pasta"]),
      entriesByDir: {
        "/root": [{ name: "pasta", isDir: true }],
        "/root/pasta": [{ name: "filho.md", isDir: false }],
      },
    });

    render(<ExplorerPanel />);

    expect(screen.getByText("filho.md")).not.toBeNull();
  });

  it("não renderiza nada quando visible é false", () => {
    useExplorerStore.setState({ visible: false });

    const { container } = render(<ExplorerPanel />);

    expect(container.firstChild).toBeNull();
  });
});
