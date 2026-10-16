import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { restoreSession, startSessionPersistence } from "./session";
import { useTabsStore } from "../store/tabsStore";
import { useDocumentStore } from "../store/documentStore";
import { discard, getPosition, saveScrollTop } from "../editor/editorStateRegistry";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

function resetStores() {
  useTabsStore.setState({ workspaceRoot: "/root", tabs: [], activeTabId: null, editingTabId: null });
  useDocumentStore.setState({ documents: {} });
}

describe("restoreSession", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    resetStores();
  });

  it("reabre as abas na mesma ordem, com a mesma aba ativa e posição semeada", async () => {
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "read_session") {
        return {
          tabs: [
            { path: "/root/a.md", cursorPos: 3, scrollTop: 40 },
            { path: "/root/b.md", cursorPos: 0, scrollTop: 0 },
            { path: "/root/c.md", cursorPos: 9, scrollTop: 120 },
          ],
          activeTabIndex: 2,
        };
      }
      if (cmd === "read_file") return `conteúdo de ${(args as { path: string }).path}`;
      throw new Error(`comando inesperado: ${cmd}`);
    });

    expect(await restoreSession()).toBe(true);

    const { tabs, activeTabId } = useTabsStore.getState();
    expect(tabs.map((t) => t.path)).toEqual(["/root/a.md", "/root/b.md", "/root/c.md"]);
    expect(activeTabId).toBe(tabs[2].id);
    expect(useDocumentStore.getState().documents[tabs[2].id].content).toBe("conteúdo de /root/c.md");
    expect(getPosition(tabs[0].id)).toEqual({ cursorPos: 3, scrollTop: 40 });
    expect(getPosition(tabs[2].id)).toEqual({ cursorPos: 9, scrollTop: 120 });
    tabs.forEach((t) => discard(t.id));
  });

  it("devolve false para sessão vazia (primeira execução), sem abrir nada", async () => {
    mockedInvoke.mockResolvedValueOnce({ tabs: [], activeTabIndex: 0 });
    expect(await restoreSession()).toBe(false);
    expect(useTabsStore.getState().tabs).toHaveLength(0);
  });

  it("devolve false, sem lançar, se o comando falhar", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedInvoke.mockRejectedValueOnce({ kind: "Io", message: "boom" });
    expect(await restoreSession()).toBe(false);
    spy.mockRestore();
  });

  it("ignora paths duplicados na sessão", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "read_session") {
        return {
          tabs: [
            { path: "/root/a.md", cursorPos: 0, scrollTop: 0 },
            { path: "/root/a.md", cursorPos: 0, scrollTop: 0 },
          ],
          activeTabIndex: 0,
        };
      }
      return "x";
    });
    await restoreSession();
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    useTabsStore.getState().tabs.forEach((t) => discard(t.id));
  });
});

describe("startSessionPersistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
    resetStores();
    useTabsStore.setState({
      tabs: [
        { id: "t1", path: "/root/a.md", title: "a.md" },
        { id: "t2", path: "/root/b.md", title: "b.md" },
      ],
      activeTabId: "t2",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    discard("t1");
    discard("t2");
  });

  it("grava a sessão 2s depois da última mudança, com ordem, ativa e posições", async () => {
    saveScrollTop("t1", 55);
    const persistence = startSessionPersistence();

    await vi.advanceTimersByTimeAsync(1999);
    expect(mockedInvoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(mockedInvoke).toHaveBeenCalledWith("write_session", {
      session: {
        tabs: [
          { path: "/root/a.md", cursorPos: 0, scrollTop: 55 },
          { path: "/root/b.md", cursorPos: 0, scrollTop: 0 },
        ],
        activeTabIndex: 1,
      },
    });
    persistence.stop();
  });

  it("reagenda ao reordenar/trocar aba e faz debounce de rajadas", async () => {
    const persistence = startSessionPersistence();
    await vi.advanceTimersByTimeAsync(2000);
    mockedInvoke.mockClear();

    useTabsStore.getState().reorderTabs(0, 1);
    useTabsStore.getState().setActiveTab("t1");
    await vi.advanceTimersByTimeAsync(2000);

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    const { session } = mockedInvoke.mock.calls[0][1] as { session: { tabs: { path: string }[]; activeTabIndex: number } };
    expect(session.tabs.map((t) => t.path)).toEqual(["/root/b.md", "/root/a.md"]);
    expect(session.activeTabIndex).toBe(1);
    persistence.stop();
  });

  it("não regrava quando nada mudou", async () => {
    const persistence = startSessionPersistence();
    await vi.advanceTimersByTimeAsync(2000);
    mockedInvoke.mockClear();
    await persistence.flush();
    expect(mockedInvoke).not.toHaveBeenCalled();
    persistence.stop();
  });

  it("flush grava imediatamente, sem esperar o debounce", async () => {
    const persistence = startSessionPersistence();
    await persistence.flush();
    expect(mockedInvoke).toHaveBeenCalledWith("write_session", expect.anything());
    persistence.stop();
  });
});
