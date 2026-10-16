import { beforeEach, describe, expect, it, vi } from "vitest";
import { commands, runCommand, getCommand, setEditorBridge } from "./registry";
import { useLayoutStore } from "../layout/layoutStore";
import { useExplorerStore } from "../explorer/explorerStore";
import { useThemeStore } from "../theme/themeStore";
import { useTabsStore } from "../store/tabsStore";
import { useZoomStore } from "../zoom/zoomStore";
import { exportActiveTabAsHtml, exportActiveTabAsPdf } from "../export/exportHtml";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mockado por completo — os testes de comportamento real de export vivem em
// exportHtml.test.ts; aqui só interessa que o id certo dispara a função certa.
vi.mock("../export/exportHtml", () => ({
  exportActiveTabAsHtml: vi.fn(),
  exportActiveTabAsPdf: vi.fn(),
}));

describe("commands registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEditorBridge(null);
  });

  it("runCommand roteia pro run() do comando certo", () => {
    const cycleViewMode = vi.fn().mockResolvedValue(undefined);
    useLayoutStore.setState({ cycleViewMode });

    runCommand("cycle_view_mode");

    expect(cycleViewMode).toHaveBeenCalledOnce();
  });

  it.each([
    ["view_editor", "editor"],
    ["view_split", "split"],
    ["view_preview", "preview"],
  ])("%s chama setViewMode(%s)", (id, mode) => {
    const setViewMode = vi.fn().mockResolvedValue(undefined);
    useLayoutStore.setState({ setViewMode });

    runCommand(id);

    expect(setViewMode).toHaveBeenCalledWith(mode);
  });

  it("id desconhecido é no-op silencioso", () => {
    expect(() => runCommand("nao_existe")).not.toThrow();
  });

  it("toggle_explorer chama explorerStore.toggle()", () => {
    const toggle = vi.fn();
    useExplorerStore.setState({ toggle });

    runCommand("toggle_explorer");

    expect(toggle).toHaveBeenCalledOnce();
  });

  it("zoom_in/zoom_out/zoom_reset chamam as actions correspondentes de zoomStore", () => {
    const zoomIn = vi.fn().mockResolvedValue(undefined);
    const zoomOut = vi.fn().mockResolvedValue(undefined);
    const resetZoom = vi.fn().mockResolvedValue(undefined);
    useZoomStore.setState({ zoomIn, zoomOut, resetZoom });

    runCommand("zoom_in");
    expect(zoomIn).toHaveBeenCalledOnce();

    runCommand("zoom_out");
    expect(zoomOut).toHaveBeenCalledOnce();

    runCommand("zoom_reset");
    expect(resetZoom).toHaveBeenCalledOnce();
  });

  it("export_html e export_pdf chamam as funções de export", () => {
    runCommand("export_html");
    expect(exportActiveTabAsHtml).toHaveBeenCalledOnce();

    runCommand("export_pdf");
    expect(exportActiveTabAsPdf).toHaveBeenCalledOnce();
  });

  it("theme_system/theme_light/theme_dark chamam setPreference com a preferência certa", () => {
    const setPreference = vi.fn().mockResolvedValue(undefined);
    useThemeStore.setState({ setPreference });

    runCommand("theme_dark");
    expect(setPreference).toHaveBeenLastCalledWith("dark");

    runCommand("theme_light");
    expect(setPreference).toHaveBeenLastCalledWith("light");

    runCommand("theme_system");
    expect(setPreference).toHaveBeenLastCalledWith("system");
  });

  it("new_tab e open_file chamam as actions correspondentes de tabsStore", () => {
    const newTab = vi.fn().mockResolvedValue(undefined);
    const openFileDialog = vi.fn().mockResolvedValue(undefined);
    useTabsStore.setState({ newTab, openFileDialog });

    runCommand("new_tab");
    expect(newTab).toHaveBeenCalledOnce();

    runCommand("open_file");
    expect(openFileDialog).toHaveBeenCalledOnce();
  });

  it("close_tab e rename_tab só agem quando há aba ativa", () => {
    const closeTab = vi.fn().mockResolvedValue(undefined);
    const startRenaming = vi.fn();
    useTabsStore.setState({ activeTabId: null, closeTab, startRenaming });

    runCommand("close_tab");
    runCommand("rename_tab");
    expect(closeTab).not.toHaveBeenCalled();
    expect(startRenaming).not.toHaveBeenCalled();

    useTabsStore.setState({ activeTabId: "tab-1", closeTab, startRenaming });
    runCommand("close_tab");
    runCommand("rename_tab");
    expect(closeTab).toHaveBeenCalledWith("tab-1");
    expect(startRenaming).toHaveBeenCalledWith("tab-1");
  });

  it("find chama a ponte do editor quando instalada, e é no-op sem ela", () => {
    expect(() => runCommand("find")).not.toThrow();

    const openSearch = vi.fn();
    setEditorBridge({ openSearch });
    runCommand("find");
    expect(openSearch).toHaveBeenCalledOnce();
  });

  it("getCommand expõe label e shortcut pra exibição (ex.: tooltip da Toolbar)", () => {
    const command = getCommand("cycle_view_mode");
    expect(command?.label).toBe("Alternar modo de exibição");
    expect(command?.shortcut).toBe("⇧⌘P");
    expect(getCommand("nao_existe")).toBeUndefined();
  });

  it("isActive reflete o estado do store em tempo real", () => {
    useLayoutStore.setState({ viewMode: "preview" });
    expect(getCommand("view_preview")?.isActive?.()).toBe(true);
    expect(getCommand("view_split")?.isActive?.()).toBe(false);

    useLayoutStore.setState({ viewMode: "editor" });
    expect(getCommand("view_editor")?.isActive?.()).toBe(true);
    expect(getCommand("view_preview")?.isActive?.()).toBe(false);
  });

  it("todos os comandos têm id único", () => {
    const ids = commands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
