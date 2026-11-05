import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useTabsStore } from "./tabsStore";
import { useDocumentStore, type DocumentEntry } from "./documentStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedOpen = vi.mocked(open);
const mockedSave = vi.mocked(save);

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
    mockedSave.mockReset();
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
    mockedInvoke.mockResolvedValueOnce({ content: "conteúdo lido", mtime: 1000 });

    await useTabsStore.getState().openTab("/root/a.md");

    const { tabs, activeTabId } = useTabsStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].path).toBe("/root/a.md");
    expect(tabs[0].title).toBe("a.md");
    expect(activeTabId).toBe(tabs[0].id);
    expect(mockedInvoke).toHaveBeenCalledWith("read_file_with_mtime", { path: "/root/a.md" });
  });

  it("openTab com um path já aberto só foca a aba existente, sem duplicar", async () => {
    mockedInvoke.mockResolvedValueOnce({ content: "conteúdo", mtime: 1000 });
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
    mockedInvoke.mockResolvedValueOnce({ content: "", mtime: 1000 });

    await useTabsStore.getState().newTab();

    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "list_dir", { path: "/root" });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "read_file_with_mtime", { path: "/root/untitled-2.md" });
    expect(useTabsStore.getState().tabs[0].path).toBe("/root/untitled-2.md");
  });

  it("newTab usa untitled.md quando o workspace está vazio", async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    mockedInvoke.mockResolvedValueOnce({ content: "", mtime: 1000 });

    await useTabsStore.getState().newTab();

    expect(useTabsStore.getState().tabs[0].path).toBe("/root/untitled.md");
  });

  it("newTab com targetDir cria untitled-N.md na pasta alvo, não na raiz", async () => {
    mockedInvoke.mockResolvedValueOnce(["untitled.md"]); // list_dir da pasta alvo
    mockedInvoke.mockResolvedValueOnce({ content: "", mtime: 1000 }); // read_file_with_mtime

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
    mockedInvoke.mockResolvedValueOnce({ content: "", mtime: 1000 }); // read_file_with_mtime do untitled.md novo

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
    mockedInvoke.mockResolvedValueOnce({ content: "conteúdo", mtime: 1000 }); // read_file_with_mtime do openTab

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
        if (cmd === "read_file_with_mtime") return { content: "conteúdo", mtime: 1000 };
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
  describe("saveAs (#127)", () => {
    function setupSavedTab(content = "texto") {
      useTabsStore.setState({
        tabs: [{ id: "tab-1", path: "/root/a.md", title: "a.md" }],
        activeTabId: "tab-1",
      });
      useDocumentStore.setState({
        documents: { "tab-1": docEntry({ path: "/root/a.md", content }) },
      });
    }

    it("grava a cópia no destino e reaponta a aba, sem tocar no original", async () => {
      setupSavedTab("texto");
      mockedInvoke.mockResolvedValueOnce(1000); // flush do original
      mockedSave.mockResolvedValueOnce("/outro/b.md");
      mockedInvoke.mockResolvedValueOnce(2000); // save_file no destino

      await useTabsStore.getState().saveAs("tab-1");

      expect(mockedSave).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "/root/a.md" }));
      expect(mockedInvoke).toHaveBeenNthCalledWith(1, "save_file", {
        path: "/root/a.md",
        content: "texto",
        expectedMtime: 1000,
      });
      expect(mockedInvoke).toHaveBeenNthCalledWith(2, "save_file", {
        path: "/outro/b.md",
        content: "texto",
        expectedMtime: null,
      });
      const calledCommands = mockedInvoke.mock.calls.map(([cmd]) => cmd);
      expect(calledCommands).not.toContain("delete_file");
      expect(calledCommands).not.toContain("rename_file");

      const tab = useTabsStore.getState().tabs[0];
      expect(tab.path).toBe("/outro/b.md");
      expect(tab.title).toBe("b.md");
      const doc = useDocumentStore.getState().documents["tab-1"];
      expect(doc.path).toBe("/outro/b.md");
      expect(doc.lastSavedMtime).toBe(2000);
      expect(doc.dirty).toBe(false);
    });

    it("acrescenta .md quando o nome escolhido não tem extensão", async () => {
      setupSavedTab();
      mockedInvoke.mockResolvedValueOnce(1000);
      mockedSave.mockResolvedValueOnce("/outro/notas");
      mockedInvoke.mockResolvedValueOnce(2000);

      await useTabsStore.getState().saveAs("tab-1");

      expect(useTabsStore.getState().tabs[0].path).toBe("/outro/notas.md");
    });

    it("cancelar o diálogo não altera nada", async () => {
      setupSavedTab();
      mockedInvoke.mockResolvedValueOnce(1000); // flush
      mockedSave.mockResolvedValueOnce(null);

      await useTabsStore.getState().saveAs("tab-1");

      expect(mockedInvoke).toHaveBeenCalledTimes(1);
      expect(useTabsStore.getState().tabs[0].path).toBe("/root/a.md");
    });

    it("escolher o próprio path é no-op", async () => {
      setupSavedTab();
      mockedInvoke.mockResolvedValueOnce(1000); // flush
      mockedSave.mockResolvedValueOnce("/root/a.md");

      await useTabsStore.getState().saveAs("tab-1");

      expect(mockedInvoke).toHaveBeenCalledTimes(1);
      expect(useTabsStore.getState().tabs[0].path).toBe("/root/a.md");
    });

    it("destino aberto em outra aba: fecha a outra sem flush e sobra uma aba para o path", async () => {
      useTabsStore.setState({
        tabs: [
          { id: "tab-1", path: "/root/a.md", title: "a.md" },
          { id: "tab-2", path: "/root/b.md", title: "b.md" },
        ],
        activeTabId: "tab-1",
      });
      useDocumentStore.setState({
        documents: {
          "tab-1": docEntry({ path: "/root/a.md", content: "novo" }),
          "tab-2": docEntry({ path: "/root/b.md", content: "antigo", dirty: true }),
        },
      });
      mockedInvoke.mockResolvedValueOnce(1000); // flush de tab-1
      mockedSave.mockResolvedValueOnce("/root/b.md");
      mockedInvoke.mockResolvedValueOnce(2000); // save_file no destino

      await useTabsStore.getState().saveAs("tab-1");

      const state = useTabsStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].id).toBe("tab-1");
      expect(state.tabs[0].path).toBe("/root/b.md");
      expect(state.activeTabId).toBe("tab-1");
      expect(useDocumentStore.getState().documents["tab-2"]).toBeUndefined();
      const destinationWrites = mockedInvoke.mock.calls.filter(
        ([cmd, args]) => cmd === "save_file" && (args as { path: string }).path === "/root/b.md",
      );
      expect(destinationWrites).toHaveLength(1);
      expect(destinationWrites[0][1]).toMatchObject({ content: "novo" });
    });

    it("falha ao gravar o destino preserva a outra aba aberta nele e retoma o autosave dela", async () => {
      vi.useFakeTimers();
      try {
        useTabsStore.setState({
          tabs: [
            { id: "tab-1", path: "/root/a.md", title: "a.md" },
            { id: "tab-2", path: "/root/b.md", title: "b.md" },
          ],
          activeTabId: "tab-1",
        });
        useDocumentStore.setState({
          documents: {
            "tab-1": docEntry({ path: "/root/a.md", content: "novo" }),
            "tab-2": docEntry({ path: "/root/b.md", content: "antigo" }),
          },
        });
        // Edição pendente na aba do destino (debounce armado).
        useDocumentStore.getState().setContent("tab-2", "edição não salva");
        mockedInvoke.mockResolvedValueOnce(1000); // flush de tab-1
        mockedSave.mockResolvedValueOnce("/root/b.md");
        mockedInvoke.mockRejectedValueOnce({ kind: "PermissionDenied", path: "/root/b.md" });
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        await useTabsStore.getState().saveAs("tab-1");

        expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["tab-1", "tab-2"]);
        expect(useDocumentStore.getState().documents["tab-2"]).toMatchObject({
          content: "edição não salva",
          dirty: true,
        });

        mockedInvoke.mockResolvedValueOnce(3000);
        await vi.advanceTimersByTimeAsync(800);
        expect(mockedInvoke).toHaveBeenLastCalledWith("save_file", {
          path: "/root/b.md",
          content: "edição não salva",
          expectedMtime: 1000,
        });
        consoleSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it("edição durante a gravação lenta não vai para o original e é salva na cópia depois", async () => {
      vi.useFakeTimers();
      try {
        setupSavedTab("texto");
        let finishWrite: (mtime: number) => void = () => {};
        mockedInvoke.mockResolvedValueOnce(1000); // flush do original
        mockedSave.mockResolvedValueOnce("/outro/b.md");
        mockedInvoke.mockImplementationOnce(() => new Promise((resolve) => (finishWrite = resolve)));

        const pending = useTabsStore.getState().saveAs("tab-1");
        await vi.advanceTimersByTimeAsync(0);
        useDocumentStore.getState().setContent("tab-1", "texto editado");
        await vi.advanceTimersByTimeAsync(2000);
        // Nenhum autosave no meio da cópia.
        expect(mockedInvoke).toHaveBeenCalledTimes(2);

        finishWrite(2000);
        await pending;
        expect(useDocumentStore.getState().documents["tab-1"]).toMatchObject({
          path: "/outro/b.md",
          lastSavedMtime: 2000,
          dirty: true,
        });

        mockedInvoke.mockResolvedValueOnce(2500);
        await vi.advanceTimersByTimeAsync(800);
        expect(mockedInvoke).toHaveBeenLastCalledWith("save_file", {
          path: "/outro/b.md",
          content: "texto editado",
          expectedMtime: 2000,
        });
        const originalWrites = mockedInvoke.mock.calls.filter(
          ([cmd, args]) => cmd === "save_file" && (args as { path: string }).path === "/root/a.md",
        );
        expect(originalWrites).toHaveLength(1); // só o flush antes do diálogo
      } finally {
        vi.useRealTimers();
      }
    });

    it("falha ao gravar o destino mantém a aba no original", async () => {
      setupSavedTab();
      mockedInvoke.mockResolvedValueOnce(1000); // flush
      mockedSave.mockResolvedValueOnce("/outro/b.md");
      mockedInvoke.mockRejectedValueOnce({ kind: "PermissionDenied", path: "/outro/b.md" });
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await useTabsStore.getState().saveAs("tab-1");

      expect(useTabsStore.getState().tabs[0].path).toBe("/root/a.md");
      expect(useDocumentStore.getState().documents["tab-1"].path).toBe("/root/a.md");
      consoleSpy.mockRestore();
    });
  });
  describe("save (#128)", () => {
    function setupTab(isNew: boolean, path = "/root/untitled-1.md") {
      const title = path.split("/").pop() ?? path;
      useTabsStore.setState({
        tabs: [isNew ? { id: "tab-1", path, title, isNew: true } : { id: "tab-1", path, title }],
        activeTabId: "tab-1",
      });
      useDocumentStore.setState({ documents: { "tab-1": docEntry({ path, content: "rascunho" }) } });
    }

    it("newTab marca a aba como nova; openTab não", async () => {
      mockedInvoke.mockResolvedValueOnce([]); // list_dir
      mockedInvoke.mockResolvedValueOnce({ content: "", mtime: 1000 }); // read_file_with_mtime
      await useTabsStore.getState().newTab();
      mockedInvoke.mockResolvedValueOnce({ content: "x", mtime: 1000 });
      await useTabsStore.getState().openTab("/root/existente.md");

      const [created, opened] = useTabsStore.getState().tabs;
      expect(created.isNew).toBe(true);
      expect(opened.isNew).toBeFalsy();
    });

    it("aba já salva: só faz o flush, sem diálogo", async () => {
      setupTab(false, "/root/a.md");
      mockedInvoke.mockResolvedValueOnce(1000); // flush

      await useTabsStore.getState().save("tab-1");

      expect(mockedSave).not.toHaveBeenCalled();
      expect(mockedInvoke).toHaveBeenCalledTimes(1);
      expect(mockedInvoke).toHaveBeenCalledWith("save_file", expect.objectContaining({ path: "/root/a.md" }));
    });

    it("aba já salva com o arquivo removido: recria no mesmo path, sem diálogo (#141)", async () => {
      setupTab(false, "/root/a.md");
      useDocumentStore.getState().handleExternalRemoval("tab-1");
      mockedInvoke.mockResolvedValueOnce(3000); // save_file

      await useTabsStore.getState().save("tab-1");

      expect(mockedSave).not.toHaveBeenCalled();
      expect(mockedInvoke).toHaveBeenCalledWith("save_file", {
        path: "/root/a.md",
        content: "rascunho",
        expectedMtime: null,
      });
      expect(useDocumentStore.getState().documents["tab-1"].status).toBe("idle");
    });

    it("aba nova: grava no destino, apaga o original, reaponta e zera isNew", async () => {
      setupTab(true);
      mockedInvoke.mockResolvedValueOnce(1000); // flush
      mockedSave.mockResolvedValueOnce("/Users/eu/notas.md");
      mockedInvoke.mockResolvedValueOnce(2000); // save_file no destino
      mockedInvoke.mockResolvedValueOnce(false); // same_file
      mockedInvoke.mockResolvedValueOnce(undefined); // delete_file

      await useTabsStore.getState().save("tab-1");

      expect(mockedSave).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "/root/untitled-1.md" }));
      expect(mockedInvoke).toHaveBeenNthCalledWith(2, "save_file", {
        path: "/Users/eu/notas.md",
        content: "rascunho",
        expectedMtime: null,
      });
      expect(mockedInvoke).toHaveBeenNthCalledWith(3, "same_file", {
        a: "/root/untitled-1.md",
        b: "/Users/eu/notas.md",
      });
      expect(mockedInvoke).toHaveBeenNthCalledWith(4, "delete_file", { path: "/root/untitled-1.md" });
      expect(mockedInvoke.mock.calls.map(([cmd]) => cmd)).not.toContain("rename_file");
      const tab = useTabsStore.getState().tabs[0];
      expect(tab).toEqual({ id: "tab-1", path: "/Users/eu/notas.md", title: "notas.md" });
      expect(useDocumentStore.getState().documents["tab-1"].path).toBe("/Users/eu/notas.md");
    });

    it("aba nova: destino é o mesmo arquivo com outra grafia — não apaga", async () => {
      setupTab(true);
      mockedInvoke.mockResolvedValueOnce(1000); // flush
      mockedSave.mockResolvedValueOnce("/root/Untitled-1.md");
      mockedInvoke.mockResolvedValueOnce(2000); // save_file
      mockedInvoke.mockResolvedValueOnce(true); // same_file

      await useTabsStore.getState().save("tab-1");

      expect(mockedInvoke.mock.calls.map(([cmd]) => cmd)).not.toContain("delete_file");
      expect(useTabsStore.getState().tabs[0]).toEqual({ id: "tab-1", path: "/root/Untitled-1.md", title: "Untitled-1.md" });
    });

    it("aba nova: erro ao comparar os paths — não apaga", async () => {
      setupTab(true);
      mockedInvoke.mockResolvedValueOnce(1000); // flush
      mockedSave.mockResolvedValueOnce("/outro/notas.md");
      mockedInvoke.mockResolvedValueOnce(2000); // save_file
      mockedInvoke.mockRejectedValueOnce({ kind: "Io", message: "falhou" }); // same_file
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await useTabsStore.getState().save("tab-1");

      expect(mockedInvoke.mock.calls.map(([cmd]) => cmd)).not.toContain("delete_file");
      expect(useTabsStore.getState().tabs[0].path).toBe("/outro/notas.md");
      consoleSpy.mockRestore();
    });

    it("aba nova com conflito externo após o flush: não abre diálogo nem move", async () => {
      setupTab(true);
      mockedInvoke.mockRejectedValueOnce({ kind: "ExternalChange", current_mtime: 1500, current_content: "do disco" });

      await useTabsStore.getState().save("tab-1");

      expect(mockedSave).not.toHaveBeenCalled();
      expect(mockedInvoke).toHaveBeenCalledTimes(1);
      expect(useTabsStore.getState().tabs[0]).toMatchObject({ path: "/root/untitled-1.md", isNew: true });
      expect(useDocumentStore.getState().documents["tab-1"].status).toBe("conflict");
    });

    it("aba nova: cancelar o diálogo não altera nada", async () => {
      setupTab(true);
      mockedInvoke.mockResolvedValueOnce(1000); // flush
      mockedSave.mockResolvedValueOnce(null);

      await useTabsStore.getState().save("tab-1");

      expect(mockedInvoke).toHaveBeenCalledTimes(1);
      expect(useTabsStore.getState().tabs[0]).toMatchObject({ path: "/root/untitled-1.md", isNew: true });
    });

    it("aba nova: escolher o próprio path só confirma o lugar", async () => {
      setupTab(true);
      mockedInvoke.mockResolvedValueOnce(1000); // flush
      mockedSave.mockResolvedValueOnce("/root/untitled-1.md");

      await useTabsStore.getState().save("tab-1");

      expect(mockedInvoke).toHaveBeenCalledTimes(1);
      expect(useTabsStore.getState().tabs[0].isNew).toBeFalsy();
    });

    it("aba nova: falha ao gravar o destino não apaga o original", async () => {
      setupTab(true);
      mockedInvoke.mockResolvedValueOnce(1000); // flush
      mockedSave.mockResolvedValueOnce("/protegido/notas.md");
      mockedInvoke.mockRejectedValueOnce({ kind: "PermissionDenied", path: "/protegido/notas.md" });
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await useTabsStore.getState().save("tab-1");

      expect(mockedInvoke.mock.calls.map(([cmd]) => cmd)).not.toContain("delete_file");
      expect(useTabsStore.getState().tabs[0]).toMatchObject({ path: "/root/untitled-1.md", isNew: true });
      consoleSpy.mockRestore();
    });

    it("saveAs numa aba nova move (apaga o original) em vez de copiar", async () => {
      setupTab(true);
      mockedInvoke.mockResolvedValueOnce(1000); // flush
      mockedSave.mockResolvedValueOnce("/root/ideias.md");
      mockedInvoke.mockResolvedValueOnce(2000); // save_file
      mockedInvoke.mockResolvedValueOnce(false); // same_file
      mockedInvoke.mockResolvedValueOnce(undefined); // delete_file

      await useTabsStore.getState().saveAs("tab-1");

      expect(mockedInvoke).toHaveBeenCalledWith("delete_file", { path: "/root/untitled-1.md" });
      expect(useTabsStore.getState().tabs[0]).toEqual({ id: "tab-1", path: "/root/ideias.md", title: "ideias.md" });
    });

    it("restoreTabs preserva isNew da sessão e trata ausência como já salva", async () => {
      mockedInvoke.mockResolvedValue("x");
      await useTabsStore.getState().restoreTabs(
        [
          { path: "/root/untitled.md", cursorPos: 0, scrollTop: 0, isNew: true },
          { path: "/root/a.md", cursorPos: 0, scrollTop: 0 },
        ],
        0,
      );
      const [first, second] = useTabsStore.getState().tabs;
      expect(first.isNew).toBe(true);
      expect(second.isNew).toBeFalsy();
    });
  });
});
