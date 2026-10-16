import { formatShortcut } from "../platform/platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Toolbar } from "./Toolbar";
import { useExplorerStore } from "../explorer/explorerStore";
import { useLayoutStore } from "../layout/layoutStore";
import { setEditorBridge } from "../commands/registry";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("Toolbar", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    setEditorBridge(null);
  });

  it("botão do explorador reflete visible e chama toggle ao clicar", () => {
    const toggle = vi.fn();
    useExplorerStore.setState({ visible: true, toggle });

    render(<Toolbar />);

    const button = screen.getByRole("button", { name: "Alternar explorador" });
    expect(button.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("botão de modo de exibição mostra o modo atual e chama cycleViewMode ao clicar", () => {
    const cycleViewMode = vi.fn().mockResolvedValue(undefined);
    useLayoutStore.setState({ viewMode: "preview", cycleViewMode });

    render(<Toolbar />);

    const button = screen.getByRole("button", { name: "Modo de exibição: Visualização" });
    expect(button.getAttribute("data-tooltip")).toBe(`Visualização — ${formatShortcut("⇧⌘P")} alterna`);

    fireEvent.click(button);
    expect(cycleViewMode).toHaveBeenCalledOnce();
  });

  it("botão de buscar aciona a ponte do editor instalada", () => {
    const openSearch = vi.fn();
    setEditorBridge({ openSearch });

    render(<Toolbar />);

    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    expect(openSearch).toHaveBeenCalledOnce();
  });

  it("renderiza os popovers de histórico, exportar e tema", () => {
    render(<Toolbar />);

    expect(screen.getByRole("button", { name: "Histórico" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Exportar" })).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Tema —/ })).not.toBeNull();
  });
});
