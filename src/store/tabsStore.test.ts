import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useTabsStore } from "./tabsStore";
import { useDocumentStore, type DocumentEntry } from "./documentStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedOpen = vi.mocked(open);

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
    mockedOpen.mockReset();
    useTabsStore.setState({
      workspaceRoot: "/root",
      tabs: [],
      activeTabId: null,
      editingTabId: null,
      pendingExternalPaths: [],
      externalOpenReady: true,
    });
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

  it("newTab com targetDir cria untitled-N.md na pasta alvo, não na raiz", async () => {
    mockedInvoke.mockResolvedValueOnce(["untitled.md"]); // list_dir da pasta alvo
    mockedInvoke.mockResolvedValueOnce(""); // read_file

    await useTabsStore.getState().newTab("/root/subpasta");

    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "list_dir", { path: "/root/subpasta" });
    expect(useTabsStore.getState().tabs[0].path).toBe("/root/subpasta/untitled-1.md");
  });

  it("closeTab com skipFlush não salva o documento antes de fechar", async () => {
    useTabsStore.setState({
      tabs: [
        { id: "tab-1", path: "/root/a.md", title: "a.md" },
        { id: "tab-2", path: "/root/b.md", title: "b.md" },
      ],
      activeTabId: "tab-2",
    });
    useDocumentStore.setState({
      documents: {
        "tab-1": docEntry({ path: "/root/a.md", dirty: true }),
        "tab-2": docEntry({ path: "/root/b.md" }),
      },
    });

    await useTabsStore.getState().closeTab("tab-1", { skipFlush: true });

    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useDocumentStore.getState().documents["tab-1"]).toBeUndefined();
  });

  it("syncPathsAfterRename atualiza a aba cujo path bate exatamente (arquivo renomeado)", () => {
    useTabsStore.setState({
      tabs: [{ id: "tab-1", path: "/root/a.md", title: "a.md" }],
      activeTabId: "tab-1",
    });
    useDocumentStore.setState({ documents: { "tab-1": docEntry({ path: "/root/a.md" }) } });

    useTabsStore.getState().syncPathsAfterRename("/root/a.md", "/root/notas.md");

    const state = useTabsStore.getState();
    expect(state.tabs[0].path).toBe("/root/notas.md");
    expect(state.tabs[0].title).toBe("notas.md");
    expect(useDocumentStore.getState().documents["tab-1"].path).toBe("/root/notas.md");
  });

  it("syncPathsAfterRename corrige abas dentro de uma pasta renomeada (prefix match)", () => {
    useTabsStore.setState({
      tabs: [
        { id: "tab-1", path: "/root/notas/a.md", title: "a.md" },
        { id: "tab-2", path: "/root/notas/sub/b.md", title: "b.md" },
        { id: "tab-3", path: "/root/outra-pasta/c.md", title: "c.md" },
      ],
      activeTabId: "tab-1",
    });
    useDocumentStore.setState({
      documents: {
        "tab-1": docEntry({ path: "/root/notas/a.md" }),
        "tab-2": docEntry({ path: "/root/notas/sub/b.md" }),
        "tab-3": docEntry({ path: "/root/outra-pasta/c.md" }),
      },
    });

    useTabsStore.getState().syncPathsAfterRename("/root/notas", "/root/anotacoes");

    const state = useTabsStore.getState();
    expect(state.tabs[0].path).toBe("/root/anotacoes/a.md");
    expect(state.tabs[1].path).toBe("/root/anotacoes/sub/b.md");
    expect(state.tabs[2].path).toBe("/root/outra-pasta/c.md"); // não afetada
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

  it("startRenaming seta editingTabId; cancelRenaming limpa sem chamar invoke", () => {
    useTabsStore.getState().startRenaming("tab-1");
    expect(useTabsStore.getState().editingTabId).toBe("tab-1");

    useTabsStore.getState().cancelRenaming();
    expect(useTabsStore.getState().editingTabId).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("commitRenaming aplica renameTab e limpa editingTabId", async () => {
    useTabsStore.setState({
      tabs: [{ id: "tab-1", path: "/root/a.md", title: "a.md" }],
      activeTabId: "tab-1",
      editingTabId: "tab-1",
    });
    useDocumentStore.setState({ documents: { "tab-1": docEntry({ path: "/root/a.md" }) } });
    mockedInvoke.mockResolvedValueOnce(1000); // flush
    mockedInvoke.mockResolvedValueOnce(undefined); // rename_file

    await useTabsStore.getState().commitRenaming("tab-1", "notas");

    expect(useTabsStore.getState().editingTabId).toBeNull();
    expect(useTabsStore.getState().tabs[0].title).toBe("notas.md");
  });

  it("commitRenaming com título em branco não chama renameTab, só limpa editingTabId", async () => {
    useTabsStore.setState({
      tabs: [{ id: "tab-1", path: "/root/a.md", title: "a.md" }],
      activeTabId: "tab-1",
      editingTabId: "tab-1",
    });

    await useTabsStore.getState().commitRenaming("tab-1", "   ");

    expect(useTabsStore.getState().editingTabId).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(useTabsStore.getState().tabs[0].title).toBe("a.md");
  });

  it("openFileDialog abre a aba do path escolhido, filtrado por .md", async () => {
    mockedOpen.mockResolvedValueOnce("/root/notas.md");
    mockedInvoke.mockResolvedValueOnce("conteúdo"); // read_file do openTab

    await useTabsStore.getState().openFileDialog();

    expect(mockedOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ name: "Markdown", extensions: ["md"] }],
        defaultPath: "/root",
        multiple: false,
        directory: false,
      }),
    );
    expect(useTabsStore.getState().tabs[0].path).toBe("/root/notas.md");
  });

  it("openFileDialog não abre aba se o usuário cancelar o seletor", async () => {
    mockedOpen.mockResolvedValueOnce(null);

    await useTabsStore.getState().openFileDialog();

    expect(useTabsStore.getState().tabs).toHaveLength(0);
    expect(mockedInvoke).not.toHaveBeenCalled();
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

  describe("openExternalPaths (#102)", () => {
    /** `validate_open_paths` aceita tudo exceto `rejected`; `read_file`
     * devolve um conteúdo qualquer. */
    function mockBackend(rejected: string[] = []) {
      mockedInvoke.mockImplementation(async (cmd, args) => {
        if (cmd === "validate_open_paths") {
          return (args as { paths: string[] }).paths.filter((p) => !rejected.includes(p));
        }
        if (cmd === "read_file") return "conteúdo";
        throw new Error(`comando inesperado: ${cmd}`);
      });
    }

    it("um path novo abre uma aba ativa", async () => {
      mockBackend();

      await useTabsStore.getState().openExternalPaths(["/fora/nota.md"]);

      const { tabs, activeTabId } = useTabsStore.getState();
      expect(tabs.map((t) => t.path)).toEqual(["/fora/nota.md"]);
      expect(activeTabId).toBe(tabs[0].id);
      expect(mockedInvoke).toHaveBeenCalledWith("validate_open_paths", { paths: ["/fora/nota.md"] });
    });

    it("um path já aberto só foca a aba existente", async () => {
      mockBackend();
      useTabsStore.setState({
        tabs: [
          { id: "tab-1", path: "/root/a.md", title: "a.md" },
          { id: "tab-2", path: "/root/b.md", title: "b.md" },
        ],
        activeTabId: "tab-2",
      });

      await useTabsStore.getState().openExternalPaths(["/root/a.md"]);

      expect(useTabsStore.getState().tabs).toHaveLength(2);
      expect(useTabsStore.getState().activeTabId).toBe("tab-1");
    });

    it("vários paths abrem uma aba cada e o último fica ativo", async () => {
      mockBackend();

      await useTabsStore.getState().openExternalPaths(["/fora/a.md", "/fora/b.md", "/fora/c.md"]);

      const { tabs, activeTabId } = useTabsStore.getState();
      expect(tabs.map((t) => t.path)).toEqual(["/fora/a.md", "/fora/b.md", "/fora/c.md"]);
      expect(activeTabId).toBe(tabs[2].id);
    });

    it("paths rejeitados pelo validador são ignorados", async () => {
      mockBackend(["/fora/pasta"]);

      await useTabsStore.getState().openExternalPaths(["/fora/a.md", "/fora/pasta"]);

      const { tabs, activeTabId } = useTabsStore.getState();
      expect(tabs.map((t) => t.path)).toEqual(["/fora/a.md"]);
      expect(activeTabId).toBe(tabs[0].id);
    });

    it("antes do fim da restauração só enfileira; depois aplica sem duplicar e vira a aba ativa", async () => {
      mockBackend();
      useTabsStore.setState({ externalOpenReady: false });

      await useTabsStore.getState().openExternalPaths(["/root/b.md"]);
      await useTabsStore.getState().openExternalPaths(["/root/c.md"]);
      expect(useTabsStore.getState().tabs).toHaveLength(0);
      expect(mockedInvoke).not.toHaveBeenCalled();

      // A restauração da sessão (#9) já reabriu b.md, com a.md ativa.
      await useTabsStore.getState().restoreTabs(
        [
          { path: "/root/a.md", cursorPos: 0, scrollTop: 0 },
          { path: "/root/b.md", cursorPos: 0, scrollTop: 0 },
        ],
        0,
      );
      await useTabsStore.getState().markExternalOpenReady();

      const { tabs, activeTabId, pendingExternalPaths } = useTabsStore.getState();
      expect(tabs.map((t) => t.path)).toEqual(["/root/a.md", "/root/b.md", "/root/c.md"]);
      expect(activeTabId).toBe(tabs[2].id);
      expect(pendingExternalPaths).toEqual([]);
    });

    it("pedidos concorrentes não se intercalam: a aba ativa é a do último pedido", async () => {
      // O primeiro pedido valida devagar; o segundo chega no meio dele (ex.:
      // evento `open-paths` enquanto o boot aplica a fila).
      let releaseFirst: () => void = () => {};
      let validations = 0;
      mockedInvoke.mockImplementation(async (cmd, args) => {
        if (cmd === "validate_open_paths") {
          validations += 1;
          if (validations === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
          return (args as { paths: string[] }).paths;
        }
        return "conteúdo";
      });

      const first = useTabsStore.getState().openExternalPaths(["/fora/a.md", "/fora/b.md"]);
      const second = useTabsStore.getState().openExternalPaths(["/fora/a.md"]);
      await vi.waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("validate_open_paths", expect.anything()));
      releaseFirst();
      await Promise.all([first, second]);

      const { tabs, activeTabId } = useTabsStore.getState();
      expect(tabs.map((t) => t.path)).toEqual(["/fora/a.md", "/fora/b.md"]);
      expect(activeTabId).toBe(tabs[0].id);
    });

    it("falha de IPC na validação não abre nada", async () => {
      mockedInvoke.mockRejectedValueOnce(new Error("ipc"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      await useTabsStore.getState().openExternalPaths(["/fora/a.md"]);

      expect(useTabsStore.getState().tabs).toHaveLength(0);
    });
  });
});
