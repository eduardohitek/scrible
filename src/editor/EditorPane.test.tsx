import { StrictMode } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { Transaction } from "@codemirror/state";
import { EditorPane } from "./EditorPane";
import { useDocumentStore, type DocumentEntry } from "../store/documentStore";
import { discard } from "./editorStateRegistry";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

function setDocument(tabId: string, content: string) {
  const entry: DocumentEntry = {
    path: `/tmp/${tabId}.md`,
    content,
    lastSavedMtime: null,
    status: "idle",
    conflict: null,
    dirty: false,
  };
  useDocumentStore.setState((state) => ({
    documents: { ...state.documents, [tabId]: entry },
  }));
}

describe("EditorPane", () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: {} });
    discard("tab-1");
    discard("tab-2");
  });

  it("sincroniza o conteúdo do editor quando o documento muda por fora da digitação (#45)", async () => {
    setDocument("tab-1", "");
    const { container } = render(<EditorPane tabId="tab-1" />);

    await waitFor(() => {
      expect(container.querySelector(".cm-content")).not.toBeNull();
    });

    setDocument("tab-1", "conteúdo carregado");

    await waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toBe("conteúdo carregado");
    });
  });

  it("resincronizar o documento não liga dirty (evita loop de autosave espúrio)", async () => {
    setDocument("tab-1", "inicial");
    const { container } = render(<EditorPane tabId="tab-1" />);

    await waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toBe("inicial");
    });

    setDocument("tab-1", "restaurado do histórico");

    await waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toBe("restaurado do histórico");
    });

    expect(useDocumentStore.getState().documents["tab-1"].dirty).toBe(false);
  });

  it("trocar de aba e voltar preserva o conteúdo de cada aba", async () => {
    setDocument("tab-1", "conteúdo da aba 1");
    setDocument("tab-2", "conteúdo da aba 2");
    const { container, rerender } = render(<EditorPane tabId="tab-1" />);

    await waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toBe("conteúdo da aba 1");
    });

    rerender(<EditorPane tabId="tab-2" />);
    await waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toBe("conteúdo da aba 2");
    });

    rerender(<EditorPane tabId="tab-1" />);
    await waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toBe("conteúdo da aba 1");
    });
  });

  it("sobrevive ao duplo-invoke de efeitos do StrictMode sem deixar a EditorView morta", async () => {
    setDocument("tab-1", "conteúdo inicial");
    const { container } = render(
      <StrictMode>
        <EditorPane tabId="tab-1" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toBe("conteúdo inicial");
    });

    const cmContent = container.querySelector(".cm-content") as HTMLElement;
    const view = EditorView.findFromDOM(cmContent);
    expect(view).not.toBeNull();

    act(() => {
      view!.dispatch({
        changes: { from: view!.state.doc.length, insert: " digitado" },
        annotations: Transaction.userEvent.of("input.type"),
      });
    });

    expect(useDocumentStore.getState().documents["tab-1"].content).toBe("conteúdo inicial digitado");
  });
});
