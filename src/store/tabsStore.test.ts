import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTabsStore } from "./tabsStore";
import { useDocumentStore, type DocumentEntry } from "./documentStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function docEntry(overrides: Partial<DocumentEntry> = {}): DocumentEntry {
  return {
    path: "/root/doc.md",
    content: "",
    lastSavedMtime: 1000,
    status: "idle",
    conflict: null,
    dirty: false,
    ...overrides,
  };
}

describe("tabsStore", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    useTabsStore.setState({ workspaceRoot: "/root", tabs: [], activeTabId: null });
    useDocumentStore.setState({ documents: {} });
  });

  it("openTab cria uma aba nova e chama initDocument", async () => {
    mockedInvoke.mockResolvedValueOnce("conteúdo lido");

    await useTabsStore.getState().openTab("/root/a.md");

    const { tabs, activeTabId } = useTabsStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].path).toBe("/root/a.md");
    expect(tabs[0].title).toBe("a.md");
    expect(activeTabId).toBe(tabs[0].id);
    expect(mockedInvoke).toHaveBeenCalledWith("read_file", { path: "/root/a.md" });
  });

  it("openTab com um path já aberto só foca a aba existente, sem duplicar", async () => {
    mockedInvoke.mockResolvedValueOnce("conteúdo");
    await useTabsStore.getState().openTab("/root/a.md");
    const firstTabId = useTabsStore.getState().tabs[0].id;

    await useTabsStore.getState().openTab("/root/b.md");
    expect(useTabsStore.getState().tabs).toHaveLength(2);

    await useTabsStore.getState().openTab("/root/a.md");

    const state = useTabsStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe(firstTabId);
  });

  it("newTab usa o primeiro nome untitled-N.md livre, checando o disco", async () => {
    mockedInvoke.mockResolvedValueOnce(["untitled.md", "untitled-1.md", "notas.md"]);
    mockedInvoke.mockResolvedValueOnce("");

    await useTabsStore.getState().newTab();

    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "list_dir", { path: "/root" });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "read_file", { path: "/root/untitled-2.md" });
    expect(useTabsStore.getState().tabs[0].path).toBe("/root/untitled-2.md");
  });

  it("newTab usa untitled.md quando o workspace está vazio", async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    mockedInvoke.mockResolvedValueOnce("");

    await useTabsStore.getState().newTab();

    expect(useTabsStore.getState().tabs[0].path).toBe("/root/untitled.md");
  });

  it("closeTab nunca deixa a lista de abas vazia — abre uma nova automaticamente", async () => {
    useTabsStore.setState({
      tabs: [{ id: "tab-1", path: "/root/a.md", title: "a.md" }],
      activeTabId: "tab-1",
    });
    useDocumentStore.setState({ documents: { "tab-1": docEntry({ path: "/root/a.md" }) } });
    mockedInvoke.mockResolvedValueOnce(1000); // flush do documento fechado
    mockedInvoke.mockResolvedValueOnce(["a.md"]); // list_dir do newTab automático
    mockedInvoke.mockResolvedValueOnce(""); // read_file do untitled.md novo

    await useTabsStore.getState().closeTab("tab-1");

    const state = useTabsStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].path).toBe("/root/untitled.md");
    expect(useDocumentStore.getState().documents["tab-1"]).toBeUndefined();
  });

  it("closeTab de uma aba não-ativa preserva a aba ativa", async () => {
    useTabsStore.setState({
      tabs: [
        { id: "tab-1", path: "/root/a.md", title: "a.md" },
        { id: "tab-2", path: "/root/b.md", title: "b.md" },
      ],
      activeTabId: "tab-2",
    });
    useDocumentStore.setState({
      documents: {
        "tab-1": docEntry({ path: "/root/a.md" }),
        "tab-2": docEntry({ path: "/root/b.md" }),
      },
    });
    mockedInvoke.mockResolvedValueOnce(1000);

    await useTabsStore.getState().closeTab("tab-1");

    const state = useTabsStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe("tab-2");
  });

  it("fechar a aba ativa foca a vizinha seguinte, ou a anterior se era a última", async () => {
    useTabsStore.setState({
      tabs: [
        { id: "tab-1", path: "/root/a.md", title: "a.md" },
        { id: "tab-2", path: "/root/b.md", title: "b.md" },
        { id: "tab-3", path: "/root/c.md", title: "c.md" },
      ],
      activeTabId: "tab-3",
    });
    useDocumentStore.setState({
      documents: {
        "tab-1": docEntry({ path: "/root/a.md" }),
        "tab-2": docEntry({ path: "/root/b.md" }),
        "tab-3": docEntry({ path: "/root/c.md" }),
      },
    });
    mockedInvoke.mockResolvedValueOnce(1000);

    await useTabsStore.getState().closeTab("tab-3");

    expect(useTabsStore.getState().activeTabId).toBe("tab-2");
  });

  it("reorderTabs move uma aba de posição sem tocar em disco", () => {
    useTabsStore.setState({
      tabs: [
        { id: "tab-1", path: "/root/a.md", title: "a.md" },
        { id: "tab-2", path: "/root/b.md", title: "b.md" },
        { id: "tab-3", path: "/root/c.md", title: "c.md" },
      ],
      activeTabId: "tab-1",
    });

    useTabsStore.getState().reorderTabs(0, 2);

    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["tab-2", "tab-3", "tab-1"]);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("renameTab salva, renomeia em disco e atualiza path/title", async () => {
    useTabsStore.setState({
      tabs: [{ id: "tab-1", path: "/root/a.md", title: "a.md" }],
      activeTabId: "tab-1",
    });
    useDocumentStore.setState({ documents: { "tab-1": docEntry({ path: "/root/a.md" }) } });
    mockedInvoke.mockResolvedValueOnce(1000); // flush
    mockedInvoke.mockResolvedValueOnce(undefined); // rename_file

    await useTabsStore.getState().renameTab("tab-1", "notas");

    expect(mockedInvoke).toHaveBeenCalledWith("rename_file", { from: "/root/a.md", to: "/root/notas.md" });
    const state = useTabsStore.getState();
    expect(state.tabs[0].path).toBe("/root/notas.md");
    expect(state.tabs[0].title).toBe("notas.md");
    expect(useDocumentStore.getState().documents["tab-1"].path).toBe("/root/notas.md");
  });

  it("renameTab mantém o título antigo se rename_file falhar", async () => {
    useTabsStore.setState({
      tabs: [{ id: "tab-1", path: "/root/a.md", title: "a.md" }],
      activeTabId: "tab-1",
    });
    useDocumentStore.setState({ documents: { "tab-1": docEntry({ path: "/root/a.md" }) } });
    mockedInvoke.mockResolvedValueOnce(1000); // flush
    mockedInvoke.mockRejectedValueOnce({ kind: "Io", message: "disco cheio" });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await useTabsStore.getState().renameTab("tab-1", "notas");

    expect(useTabsStore.getState().tabs[0].path).toBe("/root/a.md");
    expect(useTabsStore.getState().tabs[0].title).toBe("a.md");
    consoleSpy.mockRestore();
  });

  it("focusTabByIndex é 1-indexado e literal", () => {
    useTabsStore.setState({
      tabs: [
        { id: "tab-1", path: "/root/a.md", title: "a.md" },
        { id: "tab-2", path: "/root/b.md", title: "b.md" },
      ],
      activeTabId: "tab-1",
    });

    useTabsStore.getState().focusTabByIndex(2);
    expect(useTabsStore.getState().activeTabId).toBe("tab-2");
  });

  it("focusNextTab/focusPrevTab dão wraparound cíclico", () => {
    useTabsStore.setState({
      tabs: [
        { id: "tab-1", path: "/root/a.md", title: "a.md" },
        { id: "tab-2", path: "/root/b.md", title: "b.md" },
      ],
      activeTabId: "tab-2",
    });

    useTabsStore.getState().focusNextTab();
    expect(useTabsStore.getState().activeTabId).toBe("tab-1");

    useTabsStore.getState().focusPrevTab();
    expect(useTabsStore.getState().activeTabId).toBe("tab-2");
  });
});
