import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { RELOAD_MESSAGE_MS, StatusBar } from "./StatusBar";
import { useTabsStore } from "../store/tabsStore";
import { useDocumentStore } from "../store/documentStore";
import { useZoomStore } from "../zoom/zoomStore";

function setActiveDoc(content: string, status: "idle" | "saving", dirty: boolean) {
  useTabsStore.setState({ activeTabId: "tab-1" });
  useDocumentStore.setState({
    documents: {
      "tab-1": {
        path: "/tmp/doc.md",
        content,
        lastSavedMtime: 1000,
        status,
        conflict: null,
        dirty,
      },
    },
  });
}

describe("StatusBar", () => {
  beforeEach(() => {
    useTabsStore.setState({ activeTabId: null });
    useDocumentStore.setState({ documents: {} });
    useZoomStore.setState({ zoom: 1 });
  });

  it("conta palavras e caracteres do documento ativo", () => {
    setActiveDoc("uma frase de teste", "idle", false);

    render(<StatusBar />);

    expect(screen.getByText("4 palavras · 18 caracteres")).not.toBeNull();
  });

  it("usa singular quando há só uma palavra/caractere", () => {
    setActiveDoc("a", "idle", false);

    render(<StatusBar />);

    expect(screen.getByText("1 palavra · 1 caractere")).not.toBeNull();
  });

  it("mostra 0 palavras/caracteres para documento vazio", () => {
    setActiveDoc("", "idle", false);

    render(<StatusBar />);

    expect(screen.getByText("0 palavras · 0 caracteres")).not.toBeNull();
  });

  it("mostra Salvando… quando status é saving", () => {
    setActiveDoc("texto", "saving", true);

    render(<StatusBar />);

    expect(screen.getByText("Salvando…")).not.toBeNull();
  });

  it("mostra Não salvo quando dirty e não está salvando", () => {
    setActiveDoc("texto", "idle", true);

    render(<StatusBar />);

    expect(screen.getByText("Não salvo")).not.toBeNull();
  });

  it("mostra Salvo quando não é dirty e não está salvando", () => {
    setActiveDoc("texto", "idle", false);

    render(<StatusBar />);

    expect(screen.getByText("Salvo")).not.toBeNull();
  });

  it("não mostra o zoom quando está em 100%", () => {
    setActiveDoc("texto", "idle", false);

    render(<StatusBar />);

    expect(screen.queryByText("100%")).toBeNull();
  });

  it("mostra o zoom arredondado quando ≠ 100%", () => {
    setActiveDoc("texto", "idle", false);
    useZoomStore.setState({ zoom: 1.25 });

    render(<StatusBar />);

    expect(screen.getByText("125%")).not.toBeNull();
  });

  it("não quebra sem aba ativa (nenhum estado de salvamento exibido)", () => {
    render(<StatusBar />);

    expect(screen.getByText("0 palavras · 0 caracteres")).not.toBeNull();
    expect(screen.queryByText("Salvo")).toBeNull();
    expect(screen.queryByText("Não salvo")).toBeNull();
    expect(screen.queryByText("Salvando…")).toBeNull();
  });

  describe("Recarregado do disco (#142)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function addSecondDoc() {
      useDocumentStore.setState((state) => ({
        documents: {
          ...state.documents,
          "tab-2": { path: "/tmp/b.md", content: "b", lastSavedMtime: 1000, status: "idle", conflict: null, dirty: false },
        },
      }));
    }

    it("reload da aba ativa mostra a mensagem, que some depois do tempo", () => {
      setActiveDoc("texto", "idle", false);
      render(<StatusBar />);

      act(() => useDocumentStore.getState().handleExternalChange("tab-1", "do disco", 2000));
      expect(screen.getByText("Recarregado do disco")).not.toBeNull();

      act(() => vi.advanceTimersByTime(RELOAD_MESSAGE_MS));
      expect(screen.queryByText("Recarregado do disco")).toBeNull();
      expect(screen.getByText("Salvo")).not.toBeNull();
    });

    it("reload de aba em segundo plano não mostra a mensagem", () => {
      setActiveDoc("texto", "idle", false);
      addSecondDoc();
      render(<StatusBar />);

      act(() => useDocumentStore.getState().handleExternalChange("tab-2", "do disco", 2000));
      expect(screen.queryByText("Recarregado do disco")).toBeNull();

      act(() => useTabsStore.setState({ activeTabId: "tab-2" }));
      expect(screen.queryByText("Recarregado do disco")).toBeNull();
    });

    it("trocar de aba descarta a mensagem, inclusive ao voltar", () => {
      setActiveDoc("texto", "idle", false);
      addSecondDoc();
      render(<StatusBar />);

      act(() => useDocumentStore.getState().handleExternalChange("tab-1", "do disco", 2000));
      act(() => useTabsStore.setState({ activeTabId: "tab-2" }));
      act(() => useTabsStore.setState({ activeTabId: "tab-1" }));
      expect(screen.queryByText("Recarregado do disco")).toBeNull();
    });

    it("mesmo texto (touch) não mostra a mensagem", () => {
      setActiveDoc("texto", "idle", false);
      render(<StatusBar />);

      act(() => useDocumentStore.getState().handleExternalChange("tab-1", "texto", 2000));
      expect(screen.queryByText("Recarregado do disco")).toBeNull();
    });
  });
});
