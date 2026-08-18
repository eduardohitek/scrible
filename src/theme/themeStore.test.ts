import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useThemeStore } from "./themeStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function resetStore() {
  useThemeStore.setState({
    settingsPath: null,
    preference: "system",
    resolved: "light",
  });
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
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("na primeira execução (settings.json ausente) usa 'system' e persiste o default", async () => {
    mockMatchMedia(false);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") throw { kind: "NotFound", path: "/ws/.scrible/settings.json" };
      if (cmd === "save_file") return 1000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await useThemeStore.getState().init();

    expect(mockedInvoke).toHaveBeenCalledWith("save_file", {
      path: "/ws/.scrible/settings.json",
      content: JSON.stringify({ theme: "system" }),
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
      if (cmd === "read_file") return JSON.stringify({ theme: "dark" });
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await useThemeStore.getState().init();

    const state = useThemeStore.getState();
    expect(state.preference).toBe("dark");
    expect(state.resolved).toBe("dark");
  });

  it("setPreference persiste a escolha e atualiza resolved imediatamente", async () => {
    mockMatchMedia(false);
    useThemeStore.setState({ settingsPath: "/ws/.scrible/settings.json" });
    mockedInvoke.mockResolvedValueOnce(2000);

    await useThemeStore.getState().setPreference("dark");

    expect(mockedInvoke).toHaveBeenCalledWith("save_file", {
      path: "/ws/.scrible/settings.json",
      content: JSON.stringify({ theme: "dark" }),
      expectedMtime: null,
    });
    expect(useThemeStore.getState().resolved).toBe("dark");
  });

  it("registra o listener de sistema só enquanto preference === 'system'", async () => {
    const media = mockMatchMedia(false);
    useThemeStore.setState({ settingsPath: "/ws/.scrible/settings.json" });
    mockedInvoke.mockResolvedValue(2000);

    await useThemeStore.getState().setPreference("system");
    expect(media.listenerCount()).toBe(1);

    await useThemeStore.getState().setPreference("light");
    expect(media.listenerCount()).toBe(0);

    await useThemeStore.getState().setPreference("system");
    expect(media.listenerCount()).toBe(1);
  });

  it("mudança do tema do sistema só atualiza resolved quando preference === 'system'", async () => {
    const media = mockMatchMedia(false);
    useThemeStore.setState({ settingsPath: "/ws/.scrible/settings.json" });
    mockedInvoke.mockResolvedValue(2000);

    await useThemeStore.getState().setPreference("system");
    media.emit(true);
    expect(useThemeStore.getState().resolved).toBe("dark");

    await useThemeStore.getState().setPreference("light");
    media.emit(false);
    expect(useThemeStore.getState().resolved).toBe("light");
  });
});
