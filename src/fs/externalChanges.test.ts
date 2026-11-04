import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { handleExternalFileChanged, startWatchedPathsSync } from "./externalChanges";
import { useTabsStore } from "../store/tabsStore";
import { useDocumentStore, type DocumentEntry } from "../store/documentStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

function doc(path: string, content: string): DocumentEntry {
  return { path, content, lastSavedMtime: 1000, status: "idle", conflict: null, dirty: false };
}

function setTabs(paths: string[]) {
  useTabsStore.setState({
    tabs: paths.map((path, i) => ({ id: `tab-${i}`, path, title: path.split("/").pop() ?? path })),
  });
}

describe("handleExternalFileChanged", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    useTabsStore.setState({ workspaceRoot: "/root", tabs: [], activeTabId: null, editingTabId: null });
    useDocumentStore.setState({ documents: {} });
  });

  it("entrega a alteração só à aba com o path do payload", () => {
    setTabs(["/root/a.md", "/fora/b.md"]);
    useDocumentStore.setState({
      documents: { "tab-0": doc("/root/a.md", "a"), "tab-1": doc("/fora/b.md", "b") },
    });

    handleExternalFileChanged({ path: "/fora/b.md", mtime: 2000, content: "b novo" });

    const { documents } = useDocumentStore.getState();
    expect(documents["tab-1"].content).toBe("b novo");
    expect(documents["tab-1"].lastSavedMtime).toBe(2000);
    expect(documents["tab-0"].content).toBe("a");
  });

  it("ignora um path que nenhuma aba tem aberto", () => {
    setTabs(["/root/a.md"]);
    useDocumentStore.setState({ documents: { "tab-0": doc("/root/a.md", "a") } });

    handleExternalFileChanged({ path: "/root/outro.md", mtime: 2000, content: "x" });

    expect(useDocumentStore.getState().documents["tab-0"].content).toBe("a");
  });
});

describe("startWatchedPathsSync", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
    useTabsStore.setState({ workspaceRoot: "/root", tabs: [], activeTabId: null, editingTabId: null });
  });

  it("envia o conjunto atual e reenvia quando os paths das abas mudam", () => {
    setTabs(["/root/b.md", "/root/a.md"]);
    const stop = startWatchedPathsSync();

    expect(mockedInvoke).toHaveBeenLastCalledWith("set_watched_paths", { paths: ["/root/a.md", "/root/b.md"] });

    setTabs(["/root/a.md", "/root/c.md"]);
    expect(mockedInvoke).toHaveBeenLastCalledWith("set_watched_paths", { paths: ["/root/a.md", "/root/c.md"] });

    stop();
  });

  it("não chama de novo quando a mudança na store não altera o conjunto", () => {
    setTabs(["/root/a.md"]);
    const stop = startWatchedPathsSync();
    mockedInvoke.mockClear();

    useTabsStore.setState({ activeTabId: "tab-0" });
    setTabs(["/root/a.md", "/root/a.md"]);

    expect(mockedInvoke).not.toHaveBeenCalled();
    stop();
  });

  it("para de sincronizar depois de encerrado", () => {
    const stop = startWatchedPathsSync();
    stop();
    mockedInvoke.mockClear();

    setTabs(["/root/a.md"]);

    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
