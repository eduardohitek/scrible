import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

// appSettings.ts (dependência de themeStore.ts) guarda cache/loadPromise em
// escopo de módulo — cada teste precisa de uma instância fresca de ambos.
async function freshThemeStore() {
  vi.resetModules();
  const mod = await import("./themeStore");
  return mod.useThemeStore;
}

function mockMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches: initialMatches,
    addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue(mql),
  );
  return {
    emit: (matches: boolean) => {
      mql.matches = matches;
      listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent));
    },
    listenerCount: () => listeners.size,
  };
}

describe("themeStore", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("na primeira execução (settings.json ausente) usa 'system' e persiste os defaults completos", async () => {
    mockMatchMedia(false);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") throw { kind: "NotFound", path: "/ws/.scrible/settings.json" };
      if (cmd === "save_file") return 1000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useThemeStore = await freshThemeStore();

    await useThemeStore.getState().init();

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
    const state = useThemeStore.getState();
    expect(state.preference).toBe("system");
    expect(state.resolved).toBe("light");
  });

  it("lê a preferência persistida em settings.json", async () => {
    mockMatchMedia(false);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") return JSON.stringify({ theme: "dark", layout: { splitRatio: 0.5, previewVisible: true } });
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useThemeStore = await freshThemeStore();

    await useThemeStore.getState().init();

    const state = useThemeStore.getState();
    expect(state.preference).toBe("dark");
    expect(state.resolved).toBe("dark");
  });

  it("setPreference persiste a escolha preservando layout, e atualiza resolved imediatamente", async () => {
    mockMatchMedia(false);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") return JSON.stringify({ theme: "light", layout: { splitRatio: 0.6, previewVisible: false } });
      if (cmd === "save_file") return 2000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useThemeStore = await freshThemeStore();

    await useThemeStore.getState().setPreference("dark");

    expect(mockedInvoke).toHaveBeenLastCalledWith("save_file", {
      path: "/ws/.scrible/settings.json",
      content: JSON.stringify({
        theme: "dark",
        layout: { splitRatio: 0.6, previewVisible: false },
        explorer: { visible: true, width: 240 },
        zoom: 1,
        skippedVersion: null,
      }),
      expectedMtime: null,
    });
    expect(useThemeStore.getState().resolved).toBe("dark");
  });

  it("registra o listener de sistema só enquanto preference === 'system'", async () => {
    const media = mockMatchMedia(false);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") return JSON.stringify({ theme: "system", layout: { splitRatio: 0.5, previewVisible: true } });
      if (cmd === "save_file") return 2000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useThemeStore = await freshThemeStore();

    await useThemeStore.getState().setPreference("system");
    expect(media.listenerCount()).toBe(1);

    await useThemeStore.getState().setPreference("light");
    expect(media.listenerCount()).toBe(0);

    await useThemeStore.getState().setPreference("system");
    expect(media.listenerCount()).toBe(1);
  });

  it("mudança do tema do sistema só atualiza resolved quando preference === 'system'", async () => {
    const media = mockMatchMedia(false);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") return JSON.stringify({ theme: "system", layout: { splitRatio: 0.5, previewVisible: true } });
      if (cmd === "save_file") return 2000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    const useThemeStore = await freshThemeStore();

    await useThemeStore.getState().setPreference("system");
    media.emit(true);
    expect(useThemeStore.getState().resolved).toBe("dark");

    await useThemeStore.getState().setPreference("light");
    media.emit(false);
    expect(useThemeStore.getState().resolved).toBe("light");
  });
});
