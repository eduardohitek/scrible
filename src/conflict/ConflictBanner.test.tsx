import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConflictBanner } from "./ConflictBanner";
import { useDocumentStore } from "../store/documentStore";
import { useTabsStore } from "../store/tabsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("ConflictBanner", () => {
  beforeEach(() => {
    useTabsStore.setState({
      tabs: [{ id: "tab-1", path: "/tmp/doc.md", title: "doc.md" }],
      activeTabId: "tab-1",
    });
    useDocumentStore.setState({
      documents: {
        "tab-1": {
          path: "/tmp/doc.md",
          content: "minha edição local",
          lastSavedMtime: 1000,
          status: "conflict",
          conflict: { currentMtime: 3000, currentContent: "versão do disco" },
          dirty: true,
        },
      },
    });
  });

  it('"Manter minha versão" chama resolveConflict(tabId, "mine")', () => {
    const resolveConflict = vi.fn().mockResolvedValue(undefined);
    useDocumentStore.setState({ resolveConflict });

    render(<ConflictBanner />);
    fireEvent.click(screen.getByText("Manter minha versão"));

    expect(resolveConflict).toHaveBeenCalledWith("tab-1", "mine");
  });

  it('"Usar versão do disco" chama resolveConflict(tabId, "disk")', () => {
    const resolveConflict = vi.fn().mockResolvedValue(undefined);
    useDocumentStore.setState({ resolveConflict });

    render(<ConflictBanner />);
    fireEvent.click(screen.getByText("Usar versão do disco"));

    expect(resolveConflict).toHaveBeenCalledWith("tab-1", "disk");
  });
});
