import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

async function freshStore() {
  vi.resetModules();
  return (await import("./livePreviewStore")).useLivePreviewStore;
}

describe("livePreviewStore", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") return JSON.stringify({ hideMarkers: true });
      if (cmd === "save_file") return 1;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
  });

  it("default é nível 2 (marcadores visíveis)", async () => {
    const store = await freshStore();
    expect(store.getState().hideMarkers).toBe(false);
  });

  it("init carrega a preferência salva", async () => {
    const store = await freshStore();
    await store.getState().init();
    expect(store.getState().hideMarkers).toBe(true);
  });

  it("toggle alterna e persiste em settings.json preservando as outras chaves", async () => {
    const store = await freshStore();
    await store.getState().init();
    await store.getState().toggle();

    expect(store.getState().hideMarkers).toBe(false);
    const saved = mockedInvoke.mock.calls.find(([cmd]) => cmd === "save_file")?.[1] as { content: string };
    expect(JSON.parse(saved.content)).toMatchObject({ hideMarkers: false, theme: "system", zoom: 1 });
  });
});
