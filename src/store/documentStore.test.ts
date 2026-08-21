import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "./documentStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function resetStore() {
  useDocumentStore.setState({
    documents: {
      "tab-1": {
        path: "/tmp/doc.md",
        content: "",
        lastSavedMtime: 1000,
        status: "idle",
        conflict: null,
        dirty: false,
      },
    },
  });
}

describe("documentStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedInvoke.mockReset();
    resetStore();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("dispara save_file só depois de 800ms de inatividade", async () => {
    mockedInvoke.mockResolvedValueOnce(2000);

    useDocumentStore.getState().setContent("tab-1", "olá mundo");

    await vi.advanceTimersByTimeAsync(799);
    expect(mockedInvoke).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockedInvoke).toHaveBeenCalledWith("save_file", {
      path: "/tmp/doc.md",
      content: "olá mundo",
      expectedMtime: 1000,
    });
  });

  it("chamadas seguidas de setContent reiniciam o debounce", async () => {
    mockedInvoke.mockResolvedValueOnce(2000);

    useDocumentStore.getState().setContent("tab-1", "primeira versão");
    await vi.advanceTimersByTimeAsync(400);
    useDocumentStore.getState().setContent("tab-1", "versão final");
    await vi.advanceTimersByTimeAsync(799);
    expect(mockedInvoke).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith("save_file", {
      path: "/tmp/doc.md",
      content: "versão final",
      expectedMtime: 1000,
    });
  });

  it("flush() cancela o debounce pendente e salva imediatamente", async () => {
    mockedInvoke.mockResolvedValueOnce(2000);

    useDocumentStore.getState().setContent("tab-1", "conteúdo");
    await useDocumentStore.getState().flush("tab-1");

    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(800);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("save bem-sucedido atualiza lastSavedMtime e volta status a idle", async () => {
    mockedInvoke.mockResolvedValueOnce(2000);

    useDocumentStore.getState().setContent("tab-1", "conteúdo salvo");
    await useDocumentStore.getState().flush("tab-1");

    const entry = useDocumentStore.getState().documents["tab-1"];
    expect(entry.lastSavedMtime).toBe(2000);
    expect(entry.status).toBe("idle");
  });

  it("ExternalChange leva a status conflict sem retry automático", async () => {
    mockedInvoke.mockRejectedValueOnce({
      kind: "ExternalChange",
      current_mtime: 5000,
      current_content: "conteúdo em disco",
    });

    useDocumentStore.getState().setContent("tab-1", "minha edição local");
    await useDocumentStore.getState().flush("tab-1");

    const entry = useDocumentStore.getState().documents["tab-1"];
    expect(entry.status).toBe("conflict");
    expect(entry.conflict).toEqual({
      currentMtime: 5000,
      currentContent: "conteúdo em disco",
    });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("setContent liga dirty, save bem-sucedido desliga", async () => {
    mockedInvoke.mockResolvedValueOnce(2000);

    useDocumentStore.getState().setContent("tab-1", "conteúdo");
    expect(useDocumentStore.getState().documents["tab-1"].dirty).toBe(true);

    await useDocumentStore.getState().flush("tab-1");

    expect(useDocumentStore.getState().documents["tab-1"].dirty).toBe(false);
  });

  it("handleExternalChange sem edição pendente faz reload silencioso", () => {
    useDocumentStore.getState().handleExternalChange("tab-1", "versão do disco", 3000);

    const entry = useDocumentStore.getState().documents["tab-1"];
    expect(entry.content).toBe("versão do disco");
    expect(entry.lastSavedMtime).toBe(3000);
    expect(entry.status).toBe("idle");
    expect(entry.dirty).toBe(false);
  });

  it("handleExternalChange com edição pendente expõe conflito sem sobrescrever nada", () => {
    useDocumentStore.getState().setContent("tab-1", "minha edição local");

    useDocumentStore.getState().handleExternalChange("tab-1", "versão do disco", 3000);

    const entry = useDocumentStore.getState().documents["tab-1"];
    expect(entry.content).toBe("minha edição local");
    expect(entry.status).toBe("conflict");
    expect(entry.conflict).toEqual({ currentMtime: 3000, currentContent: "versão do disco" });
  });

  it('resolveConflict("disk") tira snapshot da versão local antes de descartá-la', async () => {
    useDocumentStore.setState({
      documents: {
        "tab-1": {
          path: "/tmp/doc.md",
          content: "minha edição local",
          lastSavedMtime: 1000,
          status: "conflict",
          conflict: { currentMtime: 3000, currentContent: "versão do disco" },
          dirty: true,
        },
      },
    });
    mockedInvoke.mockResolvedValueOnce(undefined);

    await useDocumentStore.getState().resolveConflict("tab-1", "disk");

    expect(mockedInvoke).toHaveBeenCalledWith("snapshot_before_discard", {
      path: "/tmp/doc.md",
      content: "minha edição local",
    });
    const entry = useDocumentStore.getState().documents["tab-1"];
    expect(entry.content).toBe("versão do disco");
    expect(entry.lastSavedMtime).toBe(3000);
    expect(entry.conflict).toBeNull();
  });

  it('resolveConflict("mine") salva o conteúdo local usando o mtime do disco', async () => {
    useDocumentStore.setState({
      documents: {
        "tab-1": {
          path: "/tmp/doc.md",
          content: "minha edição local",
          lastSavedMtime: 1000,
          status: "conflict",
          conflict: { currentMtime: 3000, currentContent: "versão do disco" },
          dirty: true,
        },
      },
    });
    mockedInvoke.mockResolvedValueOnce(4000);

    await useDocumentStore.getState().resolveConflict("tab-1", "mine");

    expect(mockedInvoke).toHaveBeenCalledWith("save_file", {
      path: "/tmp/doc.md",
      content: "minha edição local",
      expectedMtime: 3000,
    });
    const entry = useDocumentStore.getState().documents["tab-1"];
    expect(entry.lastSavedMtime).toBe(4000);
    expect(entry.status).toBe("idle");
    expect(entry.conflict).toBeNull();
  });

  it("setContent numa aba não cancela nem interfere no debounce de outra aba", async () => {
    useDocumentStore.setState({
      documents: {
        "tab-1": {
          path: "/tmp/doc1.md",
          content: "",
          lastSavedMtime: 1000,
          status: "idle",
          conflict: null,
          dirty: false,
        },
        "tab-2": {
          path: "/tmp/doc2.md",
          content: "",
          lastSavedMtime: 2000,
          status: "idle",
          conflict: null,
          dirty: false,
        },
      },
    });
    mockedInvoke.mockResolvedValueOnce(1500).mockResolvedValueOnce(2500);

    useDocumentStore.getState().setContent("tab-1", "conteúdo da aba 1");
    await vi.advanceTimersByTimeAsync(400);
    useDocumentStore.getState().setContent("tab-2", "conteúdo da aba 2");

    // 800ms depois de tab-1 ter sido editada, tab-1 já deveria ter salvo
    // mesmo que tab-2 tenha sido editada 400ms depois — timers independentes.
    await vi.advanceTimersByTimeAsync(400);
    expect(mockedInvoke).toHaveBeenCalledWith("save_file", {
      path: "/tmp/doc1.md",
      content: "conteúdo da aba 1",
      expectedMtime: 1000,
    });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(400);
    expect(mockedInvoke).toHaveBeenCalledWith("save_file", {
      path: "/tmp/doc2.md",
      content: "conteúdo da aba 2",
      expectedMtime: 2000,
    });
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
  });

  it("removeDocument cancela o debounce pendente e apaga a entrada", async () => {
    useDocumentStore.getState().setContent("tab-1", "conteúdo não salvo");

    useDocumentStore.getState().removeDocument("tab-1");

    await vi.advanceTimersByTimeAsync(800);
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().documents["tab-1"]).toBeUndefined();
  });

  it("renameDocument só troca o path, preservando content/lastSavedMtime/status", () => {
    useDocumentStore.getState().renameDocument("tab-1", "/tmp/renamed.md");

    const entry = useDocumentStore.getState().documents["tab-1"];
    expect(entry.path).toBe("/tmp/renamed.md");
    expect(entry.content).toBe("");
    expect(entry.lastSavedMtime).toBe(1000);
    expect(entry.status).toBe("idle");
  });

  it("flushAll salva todos os documentos com debounce pendente", async () => {
    useDocumentStore.setState({
      documents: {
        "tab-1": {
          path: "/tmp/doc1.md",
          content: "",
          lastSavedMtime: 1000,
          status: "idle",
          conflict: null,
          dirty: false,
        },
        "tab-2": {
          path: "/tmp/doc2.md",
          content: "",
          lastSavedMtime: 2000,
          status: "idle",
          conflict: null,
          dirty: false,
        },
      },
    });
    mockedInvoke.mockResolvedValue(9999);

    useDocumentStore.getState().setContent("tab-1", "a");
    useDocumentStore.getState().setContent("tab-2", "b");

    await useDocumentStore.getState().flushAll();

    expect(mockedInvoke).toHaveBeenCalledTimes(2);
    expect(useDocumentStore.getState().documents["tab-1"].dirty).toBe(false);
    expect(useDocumentStore.getState().documents["tab-2"].dirty).toBe(false);

    await vi.advanceTimersByTimeAsync(800);
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
  });
});
