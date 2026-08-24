import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const setZoom = vi.fn();
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn(() => ({ setZoom })),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedGetCurrentWebview = vi.mocked(getCurrentWebview);

// appSettings.ts (dependência de zoomStore.ts) guarda cache/loadPromise em
// escopo de módulo — mesma necessidade de instância fresca por teste já
// documentada em layoutStore.test.ts.
async function freshZoomStore() {
  vi.resetModules();
  const mod = await import("./zoomStore");
  return mod.useZoomStore;
}

describe("zoomStore", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedGetCurrentWebview.mockClear();
    setZoom.mockClear();
  });

  it("init() lê o zoom persistido e aplica na webview", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file")
        return JSON.stringify({
          theme: "system",
          layout: { splitRatio: 0.5, previewVisible: true },
          explorer: { visible: true, width: 240 },
          zoom: 1.25,
        });
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useZoomStore = await freshZoomStore();

    await useZoomStore.getState().init();

    expect(useZoomStore.getState().zoom).toBe(1.25);
    expect(setZoom).toHaveBeenCalledWith(1.25);
  });

  it("init() usa DEFAULT_ZOOM (1) quando settings.json não existe", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") throw { kind: "NotFound", path: "/ws/.scrible/settings.json" };
      if (cmd === "save_file") return 1000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useZoomStore = await freshZoomStore();

    await useZoomStore.getState().init();

    expect(useZoomStore.getState().zoom).toBe(1);
  });

  it("zoomIn aplica o próximo degrau, atualiza a webview e persiste", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file")
        return JSON.stringify({
          theme: "system",
          layout: { splitRatio: 0.5, previewVisible: true },
          explorer: { visible: true, width: 240 },
          zoom: 1,
        });
      if (cmd === "save_file") return 2000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useZoomStore = await freshZoomStore();

    await useZoomStore.getState().zoomIn();

    expect(useZoomStore.getState().zoom).toBe(1.1);
    expect(setZoom).toHaveBeenCalledWith(1.1);
    expect(mockedInvoke).toHaveBeenLastCalledWith("save_file", {
      path: "/ws/.scrible/settings.json",
      content: JSON.stringify({
        theme: "system",
        layout: { splitRatio: 0.5, previewVisible: true },
        explorer: { visible: true, width: 240 },
        zoom: 1.1,
      }),
      expectedMtime: null,
    });
  });

  it("zoomOut aplica o degrau anterior e persiste", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file")
        return JSON.stringify({
          theme: "system",
          layout: { splitRatio: 0.5, previewVisible: true },
          explorer: { visible: true, width: 240 },
          zoom: 1,
        });
      if (cmd === "save_file") return 2000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useZoomStore = await freshZoomStore();

    await useZoomStore.getState().zoomOut();

    expect(useZoomStore.getState().zoom).toBe(0.9);
    expect(setZoom).toHaveBeenCalledWith(0.9);
  });

  it("resetZoom volta a 100%", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file")
        return JSON.stringify({
          theme: "system",
          layout: { splitRatio: 0.5, previewVisible: true },
          explorer: { visible: true, width: 240 },
          zoom: 1.5,
        });
      if (cmd === "save_file") return 2000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useZoomStore = await freshZoomStore();
    await useZoomStore.getState().init();

    await useZoomStore.getState().resetZoom();

    expect(useZoomStore.getState().zoom).toBe(1);
    expect(setZoom).toHaveBeenLastCalledWith(1);
  });

  it("zoomIn na ponta superior (200%) é no-op — não chama setZoom nem save_file de novo", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file")
        return JSON.stringify({
          theme: "system",
          layout: { splitRatio: 0.5, previewVisible: true },
          explorer: { visible: true, width: 240 },
          zoom: 2,
        });
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useZoomStore = await freshZoomStore();
    await useZoomStore.getState().init();
    setZoom.mockClear();

    await useZoomStore.getState().zoomIn();

    expect(useZoomStore.getState().zoom).toBe(2);
    expect(setZoom).not.toHaveBeenCalled();
    expect(mockedInvoke).not.toHaveBeenCalledWith("save_file", expect.anything());
  });

  it("resetZoom já em 100% é no-op", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") throw { kind: "NotFound", path: "/ws/.scrible/settings.json" };
      if (cmd === "save_file") return 1000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useZoomStore = await freshZoomStore();
    await useZoomStore.getState().init();
    setZoom.mockClear();
    mockedInvoke.mockClear();

    await useZoomStore.getState().resetZoom();

    expect(setZoom).not.toHaveBeenCalled();
    expect(mockedInvoke).not.toHaveBeenCalledWith("save_file", expect.anything());
  });
});
