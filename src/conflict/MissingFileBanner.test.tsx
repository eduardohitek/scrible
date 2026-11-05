import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MissingFileBanner } from "./MissingFileBanner";
import { useDocumentStore } from "../store/documentStore";
import { useTabsStore } from "../store/tabsStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

describe("MissingFileBanner", () => {
  beforeEach(() => {
    useTabsStore.setState({
      tabs: [{ id: "tab-1", path: "/tmp/doc.md", title: "doc.md" }],
      activeTabId: "tab-1",
    });
  });

  it('"Salvar de novo aqui" chama restoreMissing da aba ativa', () => {
    const restoreMissing = vi.fn().mockResolvedValue(true);
    useDocumentStore.setState({ restoreMissing });

    render(<MissingFileBanner />);
    fireEvent.click(screen.getByText("Salvar de novo aqui"));

    expect(restoreMissing).toHaveBeenCalledWith("tab-1");
  });

  it('"Fechar aba" fecha a aba ativa sem flush', () => {
    const closeTab = vi.fn().mockResolvedValue(undefined);
    useTabsStore.setState({ closeTab });

    render(<MissingFileBanner />);
    fireEvent.click(screen.getByText("Fechar aba"));

    expect(closeTab).toHaveBeenCalledWith("tab-1", { skipFlush: true });
  });
});
