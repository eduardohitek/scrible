import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  checkOpenTabsOnFocus,
  handleExternalFileChanged,
  handleExternalFileRemoved,
  startWatchedPathsSync,
  type FileCheckResult,
} from "./externalChanges";
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

describe("handleExternalFileRemoved", () => {
  beforeEach(() => {
    useTabsStore.setState({ workspaceRoot: "/root", tabs: [], activeTabId: null, editingTabId: null });
    useDocumentStore.setState({ documents: {} });
  });

  it("marca como removida só a aba com o path do payload", () => {
    setTabs(["/root/a.md", "/root/b.md"]);
    useDocumentStore.setState({
      documents: { "tab-0": doc("/root/a.md", "a"), "tab-1": doc("/root/b.md", "b") },
    });

    handleExternalFileRemoved({ path: "/root/b.md" });

    const { documents } = useDocumentStore.getState();
    expect(documents["tab-1"].status).toBe("missing");
    expect(documents["tab-1"].content).toBe("b");
    expect(documents["tab-0"].status).toBe("idle");
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

describe("checkOpenTabsOnFocus (#143)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    useTabsStore.setState({ workspaceRoot: "/root", tabs: [], activeTabId: null, editingTabId: null });
    useDocumentStore.setState({ documents: {}, lastExternalReload: null });
  });

  function mockCheck(results: FileCheckResult[]) {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "check_files") return results;
      throw new Error(`comando inesperado: ${cmd}`);
    });
  }

  it("envia path e mtime conhecido de cada aba", async () => {
    setTabs(["/root/a.md", "/root/b.md"]);
    useDocumentStore.setState({
      documents: { "tab-0": doc("/root/a.md", "a"), "tab-1": { ...doc("/root/b.md", "b"), lastSavedMtime: 7 } },
    });
    mockCheck([{ kind: "Unchanged" }, { kind: "Unchanged" }]);

    await checkOpenTabsOnFocus();

    expect(mockedInvoke).toHaveBeenCalledWith("check_files", {
      files: [
        { path: "/root/a.md", knownMtime: 1000 },
        { path: "/root/b.md", knownMtime: 7 },
      ],
    });
  });

  it("mtime diferente recarrega a aba limpa pelo caminho de handleExternalChange", async () => {
    setTabs(["/root/a.md"]);
    useDocumentStore.setState({ documents: { "tab-0": doc("/root/a.md", "a") } });
    mockCheck([{ kind: "Changed", mtime: 2000, content: "a novo" }]);

    await checkOpenTabsOnFocus();

    const entry = useDocumentStore.getState().documents["tab-0"];
    expect(entry.content).toBe("a novo");
    expect(entry.lastSavedMtime).toBe(2000);
    expect(useDocumentStore.getState().lastExternalReload?.tabId).toBe("tab-0");
  });

  it("mtime diferente com edição pendente vira conflito", async () => {
    setTabs(["/root/a.md"]);
    useDocumentStore.setState({ documents: { "tab-0": { ...doc("/root/a.md", "minha"), dirty: true } } });
    mockCheck([{ kind: "Changed", mtime: 2000, content: "do disco" }]);

    await checkOpenTabsOnFocus();

    const entry = useDocumentStore.getState().documents["tab-0"];
    expect(entry.status).toBe("conflict");
    expect(entry.content).toBe("minha");
  });

  it("mtime igual não muda nada", async () => {
    setTabs(["/root/a.md"]);
    const before = doc("/root/a.md", "a");
    useDocumentStore.setState({ documents: { "tab-0": before } });
    mockCheck([{ kind: "Unchanged" }]);

    await checkOpenTabsOnFocus();

    expect(useDocumentStore.getState().documents["tab-0"]).toBe(before);
  });

  it("arquivo ausente leva a aba ao estado missing", async () => {
    setTabs(["/root/a.md"]);
    useDocumentStore.setState({ documents: { "tab-0": doc("/root/a.md", "a") } });
    mockCheck([{ kind: "Missing" }]);

    await checkOpenTabsOnFocus();

    expect(useDocumentStore.getState().documents["tab-0"].status).toBe("missing");
  });

  it("aba nova (isNew) também é checada", async () => {
    useTabsStore.setState({ tabs: [{ id: "tab-0", path: "/root/untitled.md", title: "untitled.md", isNew: true }] });
    useDocumentStore.setState({ documents: { "tab-0": doc("/root/untitled.md", "") } });
    mockCheck([{ kind: "Missing" }]);

    await checkOpenTabsOnFocus();

    expect(useDocumentStore.getState().documents["tab-0"].status).toBe("missing");
  });

  it("pula abas gravando ou com o autosave suspenso (Salvar Como)", async () => {
    setTabs(["/root/a.md", "/root/b.md"]);
    useDocumentStore.setState({
      documents: { "tab-0": { ...doc("/root/a.md", "a"), status: "saving" }, "tab-1": doc("/root/b.md", "b") },
    });
    useDocumentStore.getState().pauseAutosave("tab-1");
    mockCheck([]);

    await checkOpenTabsOnFocus();

    expect(mockedInvoke).not.toHaveBeenCalled();
    useDocumentStore.getState().resumeAutosave("tab-1");
  });

  it("em conflito, usa o mtime do disco já exposto como conhecido", async () => {
    setTabs(["/root/a.md"]);
    useDocumentStore.setState({
      documents: {
        "tab-0": {
          ...doc("/root/a.md", "minha"),
          dirty: true,
          status: "conflict",
          conflict: { currentMtime: 3000, currentContent: "disco" },
        },
      },
    });
    mockCheck([{ kind: "Unchanged" }]);

    await checkOpenTabsOnFocus();

    expect(mockedInvoke).toHaveBeenCalledWith("check_files", { files: [{ path: "/root/a.md", knownMtime: 3000 }] });
  });

  it("descarta o resultado se a aba foi salva durante a checagem", async () => {
    setTabs(["/root/a.md"]);
    useDocumentStore.setState({ documents: { "tab-0": doc("/root/a.md", "a") } });
    mockedInvoke.mockImplementation(async () => {
      useDocumentStore.setState({ documents: { "tab-0": { ...doc("/root/a.md", "a salvo"), lastSavedMtime: 2000 } } });
      return [{ kind: "Changed", mtime: 2000, content: "a salvo" }];
    });

    await checkOpenTabsOnFocus();

    const entry = useDocumentStore.getState().documents["tab-0"];
    expect(entry.status).toBe("idle");
    expect(useDocumentStore.getState().lastExternalReload).toBeNull();
  });

  it("ignora um foco enquanto outra checagem está em voo", async () => {
    setTabs(["/root/a.md"]);
    useDocumentStore.setState({ documents: { "tab-0": doc("/root/a.md", "a") } });
    let release: (value: FileCheckResult[]) => void = () => {};
    mockedInvoke.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    const first = checkOpenTabsOnFocus();
    await checkOpenTabsOnFocus();
    release([{ kind: "Unchanged" }]);
    await first;

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });
});
