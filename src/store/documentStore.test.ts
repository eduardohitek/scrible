import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "./documentStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function resetStore() {
  useDocumentStore.setState({
    path: "/tmp/doc.md",
    content: "",
    lastSavedMtime: 1000,
    status: "idle",
    conflict: null,
    dirty: false,
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

    useDocumentStore.getState().setContent("olá mundo");

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

    useDocumentStore.getState().setContent("primeira versão");
    await vi.advanceTimersByTimeAsync(400);
    useDocumentStore.getState().setContent("versão final");
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

    useDocumentStore.getState().setContent("conteúdo");
    await useDocumentStore.getState().flush();

    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(800);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("save bem-sucedido atualiza lastSavedMtime e volta status a idle", async () => {
    mockedInvoke.mockResolvedValueOnce(2000);

    useDocumentStore.getState().setContent("conteúdo salvo");
    await useDocumentStore.getState().flush();

    const state = useDocumentStore.getState();
    expect(state.lastSavedMtime).toBe(2000);
    expect(state.status).toBe("idle");
  });

  it("ExternalChange leva a status conflict sem retry automático", async () => {
    mockedInvoke.mockRejectedValueOnce({
      kind: "ExternalChange",
      current_mtime: 5000,
      current_content: "conteúdo em disco",
    });

    useDocumentStore.getState().setContent("minha edição local");
    await useDocumentStore.getState().flush();

    const state = useDocumentStore.getState();
    expect(state.status).toBe("conflict");
    expect(state.conflict).toEqual({
      currentMtime: 5000,
      currentContent: "conteúdo em disco",
    });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("setContent liga dirty, save bem-sucedido desliga", async () => {
    mockedInvoke.mockResolvedValueOnce(2000);

    useDocumentStore.getState().setContent("conteúdo");
    expect(useDocumentStore.getState().dirty).toBe(true);

    await useDocumentStore.getState().flush();

    expect(useDocumentStore.getState().dirty).toBe(false);
  });

  it("handleExternalChange sem edição pendente faz reload silencioso", () => {
    useDocumentStore.getState().handleExternalChange("versão do disco", 3000);

    const state = useDocumentStore.getState();
    expect(state.content).toBe("versão do disco");
    expect(state.lastSavedMtime).toBe(3000);
    expect(state.status).toBe("idle");
    expect(state.dirty).toBe(false);
  });

  it("handleExternalChange com edição pendente expõe conflito sem sobrescrever nada", () => {
    useDocumentStore.getState().setContent("minha edição local");

    useDocumentStore.getState().handleExternalChange("versão do disco", 3000);

    const state = useDocumentStore.getState();
    expect(state.content).toBe("minha edição local");
    expect(state.status).toBe("conflict");
    expect(state.conflict).toEqual({ currentMtime: 3000, currentContent: "versão do disco" });
  });

  it('resolveConflict("disk") tira snapshot da versão local antes de descartá-la', async () => {
    useDocumentStore.setState({
      content: "minha edição local",
      status: "conflict",
      conflict: { currentMtime: 3000, currentContent: "versão do disco" },
    });
    mockedInvoke.mockResolvedValueOnce(undefined);

    await useDocumentStore.getState().resolveConflict("disk");

    expect(mockedInvoke).toHaveBeenCalledWith("snapshot_before_discard", {
      path: "/tmp/doc.md",
      content: "minha edição local",
    });
    const state = useDocumentStore.getState();
    expect(state.content).toBe("versão do disco");
    expect(state.lastSavedMtime).toBe(3000);
    expect(state.conflict).toBeNull();
  });

  it('resolveConflict("mine") salva o conteúdo local usando o mtime do disco', async () => {
    useDocumentStore.setState({
      content: "minha edição local",
      status: "conflict",
      conflict: { currentMtime: 3000, currentContent: "versão do disco" },
    });
    mockedInvoke.mockResolvedValueOnce(4000);

    await useDocumentStore.getState().resolveConflict("mine");

    expect(mockedInvoke).toHaveBeenCalledWith("save_file", {
      path: "/tmp/doc.md",
      content: "minha edição local",
      expectedMtime: 3000,
    });
    const state = useDocumentStore.getState();
    expect(state.lastSavedMtime).toBe(4000);
    expect(state.status).toBe("idle");
    expect(state.conflict).toBeNull();
  });
});
