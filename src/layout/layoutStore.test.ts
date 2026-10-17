import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

// appSettings.ts (dependência de layoutStore.ts) guarda cache/loadPromise em
// escopo de módulo — cada teste precisa de uma instância fresca de ambos.
async function freshLayoutStore() {
  vi.resetModules();
  const mod = await import("./layoutStore");
  return mod.useLayoutStore;
}

describe("layoutStore", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("init() lê splitRatio/viewMode persistidos", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file")
        return JSON.stringify({ theme: "system", layout: { splitRatio: 0.65, viewMode: "preview" } });
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useLayoutStore = await freshLayoutStore();

    await useLayoutStore.getState().init();

    expect(useLayoutStore.getState().splitRatio).toBe(0.65);
    expect(useLayoutStore.getState().viewMode).toBe("preview");
  });

  it("init() usa defaults (0.5 / lado a lado) quando settings.json não existe", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") throw { kind: "NotFound", path: "/ws/.scrible/settings.json" };
      if (cmd === "save_file") return 1000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useLayoutStore = await freshLayoutStore();

    await useLayoutStore.getState().init();

    expect(useLayoutStore.getState().splitRatio).toBe(0.5);
    expect(useLayoutStore.getState().viewMode).toBe("split");
  });

  it("setSplitRatio persiste preservando theme e viewMode existentes", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file")
        return JSON.stringify({ theme: "dark", layout: { splitRatio: 0.5, viewMode: "split" } });
      if (cmd === "save_file") return 2000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useLayoutStore = await freshLayoutStore();

    await useLayoutStore.getState().setSplitRatio(0.72);

    expect(useLayoutStore.getState().splitRatio).toBe(0.72);
    expect(mockedInvoke).toHaveBeenLastCalledWith("save_file", {
      path: "/ws/.scrible/settings.json",
      content: JSON.stringify({
        theme: "dark",
        layout: { splitRatio: 0.72, viewMode: "split" },
        explorer: { visible: true, width: 240 },
        zoom: 1,
        skippedVersion: null,
        hideMarkers: false,
      }),
      expectedMtime: null,
    });
  });

  it("cycleViewMode percorre editor → lado a lado → visualização e persiste cada passo", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file")
        return JSON.stringify({ theme: "system", layout: { splitRatio: 0.4, viewMode: "split" } });
      if (cmd === "save_file") return 2000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useLayoutStore = await freshLayoutStore();
    await useLayoutStore.getState().init();

    await useLayoutStore.getState().cycleViewMode();
    expect(useLayoutStore.getState().viewMode).toBe("preview");
    expect(mockedInvoke).toHaveBeenLastCalledWith("save_file", {
      path: "/ws/.scrible/settings.json",
      content: JSON.stringify({
        theme: "system",
        layout: { splitRatio: 0.4, viewMode: "preview" },
        explorer: { visible: true, width: 240 },
        zoom: 1,
        skippedVersion: null,
        hideMarkers: false,
      }),
      expectedMtime: null,
    });

    await useLayoutStore.getState().cycleViewMode();
    expect(useLayoutStore.getState().viewMode).toBe("editor");

    await useLayoutStore.getState().cycleViewMode();
    expect(useLayoutStore.getState().viewMode).toBe("split");
  });
});
