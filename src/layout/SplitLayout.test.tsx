import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SplitLayout } from "./SplitLayout";
import { useLayoutStore } from "./layoutStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Isola SplitLayout do CodeMirror/mermaid reais — o que interessa aqui é a
// mecânica de resize/toggle, não o conteúdo interno dos painéis.
vi.mock("../editor/EditorPane", () => ({
  EditorPane: ({ tabId }: { tabId: string }) => <div data-testid="editor-pane">{tabId}</div>,
}));
vi.mock("../preview/PreviewPane", () => ({
  PreviewPane: ({ source }: { source: string }) => <div data-testid="preview-pane">{source}</div>,
}));

describe("SplitLayout", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      splitRatio: 0.5,
      previewVisible: true,
      setSplitRatio: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("renderiza editor e preview quando previewVisible", () => {
    render(<SplitLayout tabId="tab-1" source="# Olá" />);

    expect(screen.getByTestId("editor-pane")).not.toBeNull();
    expect(screen.getByTestId("preview-pane")).not.toBeNull();
    expect(screen.getByRole("separator")).not.toBeNull();
  });

  it("oculta preview e divisor quando previewVisible é false", () => {
    useLayoutStore.setState({ previewVisible: false });
    render(<SplitLayout tabId="tab-1" source="# Olá" />);

    expect(screen.getByTestId("editor-pane")).not.toBeNull();
    expect(screen.queryByTestId("preview-pane")).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("não renderiza EditorPane quando tabId é null", () => {
    render(<SplitLayout tabId={null} source="" />);
    expect(screen.queryByTestId("editor-pane")).toBeNull();
  });

  it("arrastar o divisor e soltar chama setSplitRatio uma única vez, com o ratio final", () => {
    render(<SplitLayout tabId="tab-1" source="# Olá" />);
    const divider = screen.getByRole("separator");

    Element.prototype.getBoundingClientRect = vi
      .fn()
      .mockReturnValue({ left: 0, width: 1000, top: 0, height: 0, right: 1000, bottom: 0 });

    fireEvent.mouseDown(divider);
    fireEvent.mouseMove(document, { clientX: 700 });
    fireEvent.mouseUp(document);

    expect(useLayoutStore.getState().setSplitRatio).toHaveBeenCalledTimes(1);
    expect(useLayoutStore.getState().setSplitRatio).toHaveBeenCalledWith(0.7);
  });

  it("mousemove sem um mousedown prévio não chama setSplitRatio", () => {
    render(<SplitLayout tabId="tab-1" source="# Olá" />);

    fireEvent.mouseMove(document, { clientX: 700 });
    fireEvent.mouseUp(document);

    expect(useLayoutStore.getState().setSplitRatio).not.toHaveBeenCalled();
  });
});
