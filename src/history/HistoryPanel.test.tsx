import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { HistoryPanel } from "./HistoryPanel";
import { useDocumentStore } from "../store/documentStore";
import { useTabsStore } from "../store/tabsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("HistoryPanel", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    useTabsStore.setState({
      tabs: [{ id: "tab-1", path: "/tmp/doc.md", title: "doc.md" }],
      activeTabId: "tab-1",
    });
    useDocumentStore.setState({
      documents: {
        "tab-1": {
          path: "/tmp/doc.md",
          content: "conteúdo atual",
          lastSavedMtime: 1000,
          status: "idle",
          conflict: null,
          dirty: false,
        },
      },
    });
  });

  it("lista os snapshots ao abrir o painel", async () => {
    mockedInvoke.mockResolvedValueOnce([
      { timestamp: Date.now() - 10 * 60_000, size: 42 },
      { timestamp: Date.now() - 30 * 60_000, size: 40 },
    ]);

    render(<HistoryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Histórico" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("list_snapshots", { path: "/tmp/doc.md" });
    });
    await waitFor(() => {
      expect(screen.getAllByText("Restaurar")).toHaveLength(2);
    });
  });

  it("restaurar chama restore_snapshot com o timestamp certo e atualiza a store", async () => {
    const targetTimestamp = Date.now() - 10 * 60_000;
    mockedInvoke.mockResolvedValueOnce([{ timestamp: targetTimestamp, size: 42 }]);
    mockedInvoke.mockResolvedValueOnce({ content: "versão restaurada", mtime: 5000 });

    render(<HistoryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Histórico" }));
    await waitFor(() => screen.getByText("Restaurar"));
    fireEvent.click(screen.getByText("Restaurar"));

    expect(mockedInvoke).toHaveBeenCalledWith("restore_snapshot", {
      path: "/tmp/doc.md",
      timestamp: targetTimestamp,
    });

    await waitFor(() => {
      const entry = useDocumentStore.getState().documents["tab-1"];
      expect(entry.content).toBe("versão restaurada");
      expect(entry.lastSavedMtime).toBe(5000);
    });
  });

  it("fecha o painel ao clicar fora dele", async () => {
    mockedInvoke.mockResolvedValueOnce([{ timestamp: Date.now() - 10 * 60_000, size: 42 }]);

    render(<HistoryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Histórico" }));
    await waitFor(() => screen.getByText("Restaurar"));

    fireEvent.mouseDown(document.body);

    expect(screen.queryByText("Restaurar")).toBeNull();
  });

  it("mantém o painel aberto ao clicar dentro dele", async () => {
    mockedInvoke.mockResolvedValueOnce([{ timestamp: Date.now() - 10 * 60_000, size: 42 }]);

    render(<HistoryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Histórico" }));
    const restoreButton = await waitFor(() => screen.getByText("Restaurar"));

    fireEvent.mouseDown(restoreButton.closest(".history-item")!);

    expect(screen.queryByText("Restaurar")).not.toBeNull();
  });
});
