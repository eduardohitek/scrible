import { beforeEach, describe, expect, it, vi } from "vitest";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { loadAppSettings, patchAppSettings, DEFAULT_SETTINGS } from "../settings/appSettings";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("../settings/appSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../settings/appSettings")>();
  return { ...actual, loadAppSettings: vi.fn(), patchAppSettings: vi.fn() };
});
const flushAll = vi.fn();
vi.mock("../store/documentStore", () => ({
  useDocumentStore: { getState: () => ({ flushAll }) },
}));

const mockedCheck = vi.mocked(check);
const mockedRelaunch = vi.mocked(relaunch);
const mockedLoad = vi.mocked(loadAppSettings);
const mockedPatch = vi.mocked(patchAppSettings);

type FakeUpdate = Awaited<ReturnType<typeof check>> & {
  close: ReturnType<typeof vi.fn>;
  downloadAndInstall: ReturnType<typeof vi.fn>;
};

function fakeUpdate(version: string): FakeUpdate {
  return {
    version,
    close: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  } as unknown as FakeUpdate;
}

// O `Update` pendente vive em escopo de módulo — instância fresca por teste.
async function freshStore() {
  vi.resetModules();
  const mod = await import("./updateStore");
  return mod.useUpdateStore;
}

describe("updateStore", () => {
  beforeEach(() => {
    mockedCheck.mockReset();
    mockedRelaunch.mockReset();
    mockedLoad.mockReset();
    mockedPatch.mockReset();
    flushAll.mockReset();
    mockedLoad.mockResolvedValue({ ...DEFAULT_SETTINGS });
  });

  it("abertura: mostra o aviso quando há versão nova", async () => {
    mockedCheck.mockResolvedValue(fakeUpdate("0.3.0"));
    const store = await freshStore();

    await store.getState().checkOnStartup();

    expect(store.getState().status).toBe("available");
    expect(store.getState().version).toBe("0.3.0");
  });

  it("abertura: fica em silêncio sem versão nova ou com erro de rede", async () => {
    const store = await freshStore();
    mockedCheck.mockResolvedValueOnce(null);
    await store.getState().checkOnStartup();
    expect(store.getState().status).toBe("hidden");

    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    mockedCheck.mockRejectedValueOnce(new Error("offline"));
    await store.getState().checkOnStartup();
    expect(store.getState().status).toBe("hidden");
  });

  it("abertura: ignora a versão pulada e libera o resource", async () => {
    const update = fakeUpdate("0.3.0");
    mockedCheck.mockResolvedValue(update);
    mockedLoad.mockResolvedValue({ ...DEFAULT_SETTINGS, skippedVersion: "0.3.0" });
    const store = await freshStore();

    await store.getState().checkOnStartup();

    expect(store.getState().status).toBe("hidden");
    expect(update.close).toHaveBeenCalled();
  });

  it("menu: oferece a versão pulada mesmo assim", async () => {
    mockedCheck.mockResolvedValue(fakeUpdate("0.3.0"));
    mockedLoad.mockResolvedValue({ ...DEFAULT_SETTINGS, skippedVersion: "0.3.0" });
    const store = await freshStore();

    await store.getState().checkManually();

    expect(store.getState().status).toBe("available");
  });

  it("menu: responde quando já está na versão mais recente ou falha", async () => {
    const store = await freshStore();
    mockedCheck.mockResolvedValueOnce(null);
    await store.getState().checkManually();
    expect(store.getState().status).toBe("upToDate");

    mockedCheck.mockRejectedValueOnce(new Error("sem rede"));
    await store.getState().checkManually();
    expect(store.getState().status).toBe("error");
    expect(store.getState().error).toBe("sem rede");
  });

  it("instalar: salva as abas antes, acompanha o progresso e reinicia", async () => {
    const update = fakeUpdate("0.3.0");
    const order: string[] = [];
    flushAll.mockImplementation(async () => {
      order.push("flush");
    });
    update.downloadAndInstall.mockImplementation(async (onEvent: (e: unknown) => void) => {
      order.push("install");
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      expect(store.getState().status).toBe("downloading");
      expect(store.getState().downloaded).toBe(40);
      expect(store.getState().total).toBe(100);
    });
    mockedRelaunch.mockImplementation(async () => {
      order.push("relaunch");
    });
    mockedCheck.mockResolvedValue(update);
    const store = await freshStore();
    await store.getState().checkManually();

    await store.getState().install();

    expect(order).toEqual(["flush", "install", "relaunch"]);
  });

  it("instalar: falha vira erro no aviso, sem reiniciar", async () => {
    const update = fakeUpdate("0.3.0");
    update.downloadAndInstall.mockRejectedValue(new Error("assinatura inválida"));
    mockedCheck.mockResolvedValue(update);
    const store = await freshStore();
    await store.getState().checkManually();

    await store.getState().install();

    expect(store.getState().status).toBe("error");
    expect(store.getState().error).toBe("assinatura inválida");
    expect(mockedRelaunch).not.toHaveBeenCalled();
  });

  it("depois: esconde o aviso sem gravar nada", async () => {
    const update = fakeUpdate("0.3.0");
    mockedCheck.mockResolvedValue(update);
    const store = await freshStore();
    await store.getState().checkOnStartup();

    store.getState().dismiss();

    expect(store.getState().status).toBe("hidden");
    expect(update.close).toHaveBeenCalled();
    expect(mockedPatch).not.toHaveBeenCalled();
  });

  it("pular: esconde o aviso e grava skippedVersion", async () => {
    mockedCheck.mockResolvedValue(fakeUpdate("0.3.0"));
    const store = await freshStore();
    await store.getState().checkOnStartup();

    await store.getState().skip();

    expect(store.getState().status).toBe("hidden");
    expect(mockedPatch).toHaveBeenCalledWith({ skippedVersion: "0.3.0" });
  });
});
