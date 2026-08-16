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
});
