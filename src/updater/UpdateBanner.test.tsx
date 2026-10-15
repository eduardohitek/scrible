import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { UpdateBanner } from "./UpdateBanner";
import { useUpdateStore } from "./updateStore";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const initial = useUpdateStore.getState();

describe("UpdateBanner", () => {
  afterEach(() => {
    cleanup();
    useUpdateStore.setState(initial, true);
  });

  it("não renderiza nada sem atualização", () => {
    const { container } = render(<UpdateBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("versão disponível: mostra as três ações e liga cada uma à store", () => {
    const install = vi.fn();
    const dismiss = vi.fn();
    const skip = vi.fn();
    useUpdateStore.setState({ status: "available", version: "0.3.0", install, dismiss, skip });
    render(<UpdateBanner />);

    expect(screen.getByText(/versão 0\.3\.0/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar e reiniciar" }));
    fireEvent.click(screen.getByRole("button", { name: "Depois" }));
    fireEvent.click(screen.getByRole("button", { name: "Pular esta versão" }));
    expect(install).toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalled();
    expect(skip).toHaveBeenCalled();
  });

  it("ver novidades abre a página da release", () => {
    useUpdateStore.setState({ status: "available", version: "0.3.0" });
    render(<UpdateBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Ver novidades" }));

    expect(openUrl).toHaveBeenCalledWith("https://github.com/eduardohitek/scrible/releases/tag/v0.3.0");
  });

  it("baixando: mostra o progresso sem botões", () => {
    useUpdateStore.setState({ status: "downloading", version: "0.3.0", downloaded: 25, total: 100 });
    render(<UpdateBanner />);

    expect(screen.getByText(/25%/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("já atualizado: mostra a mensagem e o botão fechar", () => {
    useUpdateStore.setState({ status: "upToDate" });
    render(<UpdateBanner />);

    expect(screen.getByText("Você já está na versão mais recente.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fechar" })).toBeTruthy();
  });
});
