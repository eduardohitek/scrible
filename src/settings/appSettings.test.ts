import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

// Cada teste importa uma instância fresca do módulo: appSettings.ts guarda
// cache/loadPromise/writeQueue em escopo de módulo (por design, ver
// comentário no próprio arquivo), então testes concorrentes/sucessivos
// precisam de estado isolado.
async function freshModule() {
  vi.resetModules();
  return import("./appSettings");
}

describe("appSettings", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("primeira execução (settings.json ausente): grava e retorna os defaults completos", async () => {
    const { loadAppSettings } = await freshModule();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") throw { kind: "NotFound", path: "/ws/.scrible/settings.json" };
      if (cmd === "save_file") return 1000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const settings = await loadAppSettings();

    expect(settings).toEqual({
      theme: "system",
      layout: { splitRatio: 0.5, previewVisible: true },
      explorer: { visible: true, width: 240 },
      zoom: 1,
      skippedVersion: null,
    });
    expect(mockedInvoke).toHaveBeenCalledWith("save_file", {
      path: "/ws/.scrible/settings.json",
      content: JSON.stringify({
        theme: "system",
        layout: { splitRatio: 0.5, previewVisible: true },
        explorer: { visible: true, width: 240 },
        zoom: 1,
        skippedVersion: null,
      }),
      expectedMtime: null,
    });
  });

  it("chamadas concorrentes a loadAppSettings() disparam só uma leitura", async () => {
    const { loadAppSettings } = await freshModule();
    let readCalls = 0;
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") {
        readCalls += 1;
        return JSON.stringify({ theme: "dark", layout: { splitRatio: 0.6, previewVisible: false } });
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const [a, b, c] = await Promise.all([loadAppSettings(), loadAppSettings(), loadAppSettings()]);

    expect(readCalls).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("patchAppSettings preserva a outra chave (prova da correção da race documentada em DECISIONS.md)", async () => {
    const { loadAppSettings, patchAppSettings } = await freshModule();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file")
        return JSON.stringify({
          theme: "dark",
          layout: { splitRatio: 0.5, previewVisible: true },
          explorer: { visible: true, width: 240 },
        });
      if (cmd === "save_file") return 2000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    await loadAppSettings();

    await patchAppSettings({ layout: { splitRatio: 0.7, previewVisible: true } });

    expect(mockedInvoke).toHaveBeenCalledWith("save_file", {
      path: "/ws/.scrible/settings.json",
      content: JSON.stringify({
        theme: "dark",
        layout: { splitRatio: 0.7, previewVisible: true },
        explorer: { visible: true, width: 240 },
        zoom: 1,
        skippedVersion: null,
      }),
      expectedMtime: null,
    });

    await patchAppSettings({ theme: "light" });

    expect(mockedInvoke).toHaveBeenLastCalledWith("save_file", {
      path: "/ws/.scrible/settings.json",
      content: JSON.stringify({
        theme: "light",
        layout: { splitRatio: 0.7, previewVisible: true },
        explorer: { visible: true, width: 240 },
        zoom: 1,
        skippedVersion: null,
      }),
      expectedMtime: null,
    });
  });

  it("patchAppSettings preserva layout/theme ao atualizar só a chave explorer", async () => {
    const { loadAppSettings, patchAppSettings } = await freshModule();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file")
        return JSON.stringify({
          theme: "dark",
          layout: { splitRatio: 0.5, previewVisible: true },
          explorer: { visible: true, width: 240 },
        });
      if (cmd === "save_file") return 2000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    await loadAppSettings();

    await patchAppSettings({ explorer: { visible: false, width: 240 } });

    expect(mockedInvoke).toHaveBeenLastCalledWith("save_file", {
      path: "/ws/.scrible/settings.json",
      content: JSON.stringify({
        theme: "dark",
        layout: { splitRatio: 0.5, previewVisible: true },
        explorer: { visible: false, width: 240 },
        zoom: 1,
        skippedVersion: null,
      }),
      expectedMtime: null,
    });
  });

  it("erro de leitura diferente de NotFound não sobrescreve o arquivo, usa defaults em memória", async () => {
    const { loadAppSettings } = await freshModule();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") throw { kind: "PermissionDenied" };
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const settings = await loadAppSettings();

    expect(settings).toEqual({
      theme: "system",
      layout: { splitRatio: 0.5, previewVisible: true },
      explorer: { visible: true, width: 240 },
      zoom: 1,
      skippedVersion: null,
    });
    expect(mockedInvoke).not.toHaveBeenCalledWith("save_file", expect.anything());
  });

  it("zoom persistido é lido de volta", async () => {
    const { loadAppSettings } = await freshModule();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file")
        return JSON.stringify({
          theme: "system",
          layout: { splitRatio: 0.5, previewVisible: true },
          explorer: { visible: true, width: 240 },
          zoom: 1.25,
          skippedVersion: null,
        });
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const settings = await loadAppSettings();

    expect(settings.zoom).toBe(1.25);
  });

  it("zoom inválido em settings.json cai no degrau mais próximo (snapZoom)", async () => {
    const { loadAppSettings } = await freshModule();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file")
        return JSON.stringify({
          theme: "system",
          layout: { splitRatio: 0.5, previewVisible: true },
          explorer: { visible: true, width: 240 },
          zoom: 3,
          skippedVersion: null,
        });
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const settings = await loadAppSettings();

    expect(settings.zoom).toBe(2);
  });

  it("skippedVersion é lido de volta, e valor que não é string vira null", async () => {
    for (const [raw, expected] of [
      ["0.3.0", "0.3.0"],
      [42, null],
    ] as const) {
      const { loadAppSettings } = await freshModule();
      mockedInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
        if (cmd === "read_file") return JSON.stringify({ theme: "system", skippedVersion: raw });
        throw new Error(`unexpected invoke: ${cmd}`);
      });

      const settings = await loadAppSettings();

      expect(settings.skippedVersion).toBe(expected);
    }
  });
});
