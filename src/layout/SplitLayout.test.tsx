import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRef, forwardRef, useImperativeHandle } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SplitLayout, type SplitLayoutHandle } from "./SplitLayout";
import { useLayoutStore } from "./layoutStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Isola SplitLayout do CodeMirror/mermaid reais — o que interessa aqui é a
// mecânica de resize/toggle, não o conteúdo interno dos painéis. Seguem
// `forwardRef` (sem implementar a API imperativa: useScrollSync trata
// handles ausentes/nulos como "sync desabilitado" e não faz nada) só pra não
// gerar o warning do React de passar `ref` pra um function component puro.
const editorHandle = { openSearch: vi.fn(), focus: vi.fn() };
vi.mock("../editor/EditorPane", () => ({
  EditorPane: forwardRef<unknown, { tabId: string; hidden?: boolean }>(({ tabId, hidden }, ref) => {
    useImperativeHandle(ref, () => editorHandle);
    return (
      <div data-testid="editor-pane" data-hidden={String(Boolean(hidden))}>
        {tabId}
      </div>
    );
  }),
}));
vi.mock("../preview/PreviewPane", () => ({
  PreviewPane: forwardRef<unknown, { source: string }>(({ source }) => (
    <div data-testid="preview-pane">{source}</div>
  )),
}));

describe("SplitLayout", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      splitRatio: 0.5,
      viewMode: "split",
      setSplitRatio: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("renderiza editor e preview lado a lado", () => {
    render(<SplitLayout tabId="tab-1" source="# Olá" />);

    expect(screen.getByTestId("editor-pane")).not.toBeNull();
    expect(screen.getByTestId("preview-pane")).not.toBeNull();
    expect(screen.getByRole("separator")).not.toBeNull();
  });

  it("só editor: oculta preview e divisor", () => {
    useLayoutStore.setState({ viewMode: "editor" });
    render(<SplitLayout tabId="tab-1" source="# Olá" />);

    expect(screen.getByTestId("editor-pane")).not.toBeNull();
    expect(screen.queryByTestId("preview-pane")).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("só visualização: editor continua montado mas oculto, sem divisor", () => {
    useLayoutStore.setState({ viewMode: "preview" });
    render(<SplitLayout tabId="tab-1" source="# Olá" />);

    expect(screen.getByTestId("editor-pane").dataset.hidden).toBe("true");
    expect(screen.getByTestId("preview-pane")).not.toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("buscar no modo só visualização volta pro lado a lado e abre a busca no editor", () => {
    const openSearch = vi.fn();
    editorHandle.openSearch = openSearch;
    useLayoutStore.setState({
      viewMode: "preview",
      setViewMode: vi.fn(async (viewMode) => useLayoutStore.setState({ viewMode })),
    });
    const ref = createRef<SplitLayoutHandle>();
    render(<SplitLayout ref={ref} tabId="tab-1" source="# Olá" />);

    act(() => ref.current?.openSearch());

    expect(useLayoutStore.getState().viewMode).toBe("split");
    expect(openSearch).toHaveBeenCalledOnce();
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
