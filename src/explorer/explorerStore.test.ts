import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { useExplorerStore } from "./explorerStore";
import { useTabsStore } from "../store/tabsStore";
import { useDocumentStore, type DocumentEntry } from "../store/documentStore";
import { DEFAULT_EXPLORER_WIDTH_PX } from "./constants";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  open: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedAsk = vi.mocked(ask);

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

describe("explorerStore", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedAsk.mockReset();
    useExplorerStore.setState({
      workspaceRoot: null,
      visible: true,
      width: DEFAULT_EXPLORER_WIDTH_PX,
      expandedDirs: new Set(),
      entriesByDir: {},
    });
    useTabsStore.setState({ workspaceRoot: "/root", tabs: [], activeTabId: null, editingTabId: null });
    useDocumentStore.setState({ documents: {} });
  });

  it("init carrega visible/width persistidos e busca a raiz", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/root", hidden: "/root/.scrible" };
      if (cmd === "read_file")
        return JSON.stringify({
          theme: "system",
          layout: { splitRatio: 0.5, viewMode: "split" },
          explorer: { visible: false, width: 300 },
        });
      if (cmd === "list_dir_entries") return [{ name: "nota.md", isDir: false }];
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await useExplorerStore.getState().init("/root");

    const state = useExplorerStore.getState();
    expect(state.visible).toBe(false);
    expect(state.width).toBe(300);
    expect(state.entriesByDir["/root"]).toEqual([{ name: "nota.md", isDir: false }]);
  });

  it("toggleDir expande e busca entradas só na primeira vez (cache)", async () => {
    useExplorerStore.setState({ workspaceRoot: "/root" });
    mockedInvoke.mockResolvedValue([{ name: "sub.md", isDir: false }]);

    await useExplorerStore.getState().toggleDir("/root/pasta");
    expect(useExplorerStore.getState().expandedDirs.has("/root/pasta")).toBe(true);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    await useExplorerStore.getState().toggleDir("/root/pasta"); // colapsa
    expect(useExplorerStore.getState().expandedDirs.has("/root/pasta")).toBe(false);

    await useExplorerStore.getState().toggleDir("/root/pasta"); // expande de novo
    expect(mockedInvoke).toHaveBeenCalledTimes(1); // já em cache, sem novo invoke
  });

  it("refreshVisible re-busca a raiz e as pastas expandidas, não pastas colapsadas", async () => {
    useExplorerStore.setState({
      workspaceRoot: "/root",
      expandedDirs: new Set(["/root/expandida"]),
      entriesByDir: { "/root": [], "/root/expandida": [], "/root/colapsada": [] },
    });
    mockedInvoke.mockResolvedValue([]);

    await useExplorerStore.getState().refreshVisible();

    const calledPaths = mockedInvoke.mock.calls.map((call) => (call[1] as { path: string }).path);
    expect(calledPaths.sort()).toEqual(["/root", "/root/expandida"]);
  });

  it("createFile delega pra tabsStore.newTab com o diretório alvo e reflete no cache", async () => {
    useExplorerStore.setState({ workspaceRoot: "/root" });
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_dir") return [];
      if (cmd === "read_file") return "";
      if (cmd === "list_dir_entries") return [{ name: "untitled.md", isDir: false }];
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await useExplorerStore.getState().createFile("/root/subpasta");

    expect(useTabsStore.getState().tabs[0].path).toBe("/root/subpasta/untitled.md");
    expect(useExplorerStore.getState().entriesByDir["/root/subpasta"]).toEqual([
      { name: "untitled.md", isDir: false },
    ]);
  });

  it("createFolder usa nome incremental nova-pasta-N checando o disco", async () => {
    useExplorerStore.setState({ workspaceRoot: "/root" });
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_dir") return ["nova-pasta"];
      if (cmd === "create_dir") return undefined;
      if (cmd === "list_dir_entries") return [];
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await useExplorerStore.getState().createFolder("/root");

    expect(mockedInvoke).toHaveBeenCalledWith("create_dir", { path: "/root/nova-pasta-1" });
  });

  it("renameEntry renomeia em disco, sincroniza abas e migra chaves de cache prefixadas", async () => {
    useExplorerStore.setState({
      workspaceRoot: "/root",
      expandedDirs: new Set(["/root/notas"]),
      entriesByDir: { "/root/notas": [{ name: "a.md", isDir: false }] },
    });
    useTabsStore.setState({
      workspaceRoot: "/root",
      tabs: [{ id: "tab-1", path: "/root/notas/a.md", title: "a.md" }],
      activeTabId: "tab-1",
    });
    useDocumentStore.setState({ documents: { "tab-1": docEntry({ path: "/root/notas/a.md" }) } });
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "rename_file") return undefined;
      if (cmd === "list_dir_entries") return [];
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await useExplorerStore.getState().renameEntry("/root/notas", "anotacoes", true);

    expect(mockedInvoke).toHaveBeenCalledWith("rename_file", { from: "/root/notas", to: "/root/anotacoes" });
    expect(useTabsStore.getState().tabs[0].path).toBe("/root/anotacoes/a.md");
    const state = useExplorerStore.getState();
    expect(state.entriesByDir["/root/anotacoes"]).toEqual([{ name: "a.md", isDir: false }]);
    expect(state.entriesByDir["/root/notas"]).toBeUndefined();
    expect(state.expandedDirs.has("/root/anotacoes")).toBe(true);
    expect(state.expandedDirs.has("/root/notas")).toBe(false);
  });

  it("deleteEntry não faz nada se o usuário cancelar a confirmação", async () => {
    mockedAsk.mockResolvedValueOnce(false);

    await useExplorerStore.getState().deleteEntry("/root/a.md", false);

    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("deleteEntry fecha abas afetadas sem flush e exclui do disco", async () => {
    useExplorerStore.setState({ workspaceRoot: "/root" });
    useTabsStore.setState({
      workspaceRoot: "/root",
      tabs: [
        { id: "tab-1", path: "/root/pasta/a.md", title: "a.md" },
        { id: "tab-2", path: "/root/outro.md", title: "outro.md" },
      ],
      activeTabId: "tab-1",
    });
    useDocumentStore.setState({
      documents: {
        "tab-1": docEntry({ path: "/root/pasta/a.md", dirty: true }),
        "tab-2": docEntry({ path: "/root/outro.md" }),
      },
    });
    mockedAsk.mockResolvedValueOnce(true);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "delete_dir") return undefined;
      if (cmd === "list_dir_entries") return [];
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await useExplorerStore.getState().deleteEntry("/root/pasta", true);

    // skipFlush: nenhum invoke de save_file foi disparado pro documento sujo
    expect(mockedInvoke).not.toHaveBeenCalledWith("save_file", expect.anything());
    expect(mockedInvoke).toHaveBeenCalledWith("delete_dir", { path: "/root/pasta" });
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["tab-2"]);
  });
});
