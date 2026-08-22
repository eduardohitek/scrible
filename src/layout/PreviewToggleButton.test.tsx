import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PreviewToggleButton } from "./PreviewToggleButton";
import { useLayoutStore } from "./layoutStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("PreviewToggleButton", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      splitRatio: 0.5,
      previewVisible: true,
      togglePreview: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("mostra 'Ocultar preview' quando previewVisible é true", () => {
    render(<PreviewToggleButton />);
    expect(screen.getByText("Ocultar preview")).not.toBeNull();
  });

  it("mostra 'Mostrar preview' quando previewVisible é false", () => {
    useLayoutStore.setState({ previewVisible: false });
    render(<PreviewToggleButton />);
    expect(screen.getByText("Mostrar preview")).not.toBeNull();
  });

  it("clicar chama togglePreview", () => {
    render(<PreviewToggleButton />);
    fireEvent.click(screen.getByRole("button"));
    expect(useLayoutStore.getState().togglePreview).toHaveBeenCalled();
  });
});
