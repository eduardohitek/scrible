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

  it("botão de preview reflete previewVisible e chama togglePreview ao clicar", () => {
    const togglePreview = vi.fn().mockResolvedValue(undefined);
    useLayoutStore.setState({ previewVisible: false, togglePreview });

    render(<Toolbar />);

    const button = screen.getByRole("button", { name: "Alternar preview" });
    expect(button.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button);
    expect(togglePreview).toHaveBeenCalledOnce();
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
