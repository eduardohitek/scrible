import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConflictBanner } from "./ConflictBanner";
import { useDocumentStore } from "../store/documentStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("ConflictBanner", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      path: "/tmp/doc.md",
      content: "minha edição local",
      lastSavedMtime: 1000,
      status: "conflict",
      conflict: { currentMtime: 3000, currentContent: "versão do disco" },
      dirty: true,
    });
  });

  it('"Manter minha versão" chama resolveConflict("mine")', () => {
    const resolveConflict = vi.fn().mockResolvedValue(undefined);
    useDocumentStore.setState({ resolveConflict });

    render(<ConflictBanner />);
    fireEvent.click(screen.getByText("Manter minha versão"));

    expect(resolveConflict).toHaveBeenCalledWith("mine");
  });

  it('"Usar versão do disco" chama resolveConflict("disk")', () => {
    const resolveConflict = vi.fn().mockResolvedValue(undefined);
    useDocumentStore.setState({ resolveConflict });

    render(<ConflictBanner />);
    fireEvent.click(screen.getByText("Usar versão do disco"));

    expect(resolveConflict).toHaveBeenCalledWith("disk");
  });
});
