import { beforeEach, describe, expect, it, vi } from "vitest";
import { message } from "@tauri-apps/plugin-dialog";
import { confirmQuitWithMissingFiles } from "./missingFiles";
import { useDocumentStore, type DocumentEntry, type DocumentStatus } from "../store/documentStore";
import { useTabsStore } from "../store/tabsStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), message: vi.fn() }));

const mockedMessage = vi.mocked(message);
const restoreMissing = vi.fn<(tabId: string) => Promise<boolean>>();

function entry(status: DocumentStatus): DocumentEntry {
  return { path: "/x.md", content: "texto", lastSavedMtime: 1, status, conflict: null, dirty: false };
}

function setup(statuses: DocumentStatus[]) {
  useTabsStore.setState({
    tabs: statuses.map((_, i) => ({ id: `tab-${i}`, path: `/root/${i}.md`, title: `${i}.md` })),
  });
  useDocumentStore.setState({
    documents: Object.fromEntries(statuses.map((status, i) => [`tab-${i}`, entry(status)])),
    restoreMissing,
  });
}

describe("confirmQuitWithMissingFiles", () => {
  beforeEach(() => {
    mockedMessage.mockReset();
    restoreMissing.mockReset();
  });

  it("sai sem perguntar quando nenhuma aba está com o arquivo removido", async () => {
    setup(["idle", "conflict"]);

    expect(await confirmQuitWithMissingFiles()).toBe(true);
    expect(mockedMessage).not.toHaveBeenCalled();
  });

  it('"Recriar" recria só as abas removidas e libera a saída', async () => {
    setup(["idle", "missing", "missing"]);
    mockedMessage.mockResolvedValueOnce("Recriar");
    restoreMissing.mockResolvedValue(true);

    expect(await confirmQuitWithMissingFiles()).toBe(true);
    expect(restoreMissing.mock.calls).toEqual([["tab-1"], ["tab-2"]]);
  });

  it("aceita a chave padrão do botão como resposta", async () => {
    setup(["missing"]);
    mockedMessage.mockResolvedValueOnce("Yes");
    restoreMissing.mockResolvedValue(true);

    expect(await confirmQuitWithMissingFiles()).toBe(true);
    expect(restoreMissing).toHaveBeenCalledWith("tab-0");
  });

  it('"Sair sem recriar" libera a saída sem gravar nada', async () => {
    setup(["missing"]);
    mockedMessage.mockResolvedValueOnce("Sair sem recriar");

    expect(await confirmQuitWithMissingFiles()).toBe(true);
    expect(restoreMissing).not.toHaveBeenCalled();
  });

  it('"Cancelar" mantém o app aberto', async () => {
    setup(["missing"]);
    mockedMessage.mockResolvedValueOnce("Cancelar");

    expect(await confirmQuitWithMissingFiles()).toBe(false);
    expect(restoreMissing).not.toHaveBeenCalled();
  });

  it("mantém o app aberto e avisa quando uma recriação falha", async () => {
    setup(["missing"]);
    mockedMessage.mockResolvedValueOnce("Recriar").mockResolvedValueOnce("Ok");
    restoreMissing.mockResolvedValue(false);

    expect(await confirmQuitWithMissingFiles()).toBe(false);
    expect(mockedMessage).toHaveBeenCalledTimes(2);
  });
});
