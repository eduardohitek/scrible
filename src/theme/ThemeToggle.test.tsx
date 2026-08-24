import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { ThemeToggle } from "./ThemeToggle";
import { useThemeStore } from "./themeStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("ThemeToggle", () => {
  beforeEach(() => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_status") return { root: "/ws", hidden: "/ws/.scrible" };
      if (cmd === "read_file") throw { kind: "NotFound", path: "/ws/.scrible/settings.json" };
      if (cmd === "save_file") return 1000;
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    useThemeStore.setState({
      preference: "system",
      resolved: "light",
    });
  });

  it("mostra a preferência atual no aria-label do botão", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Tema — Sistema" })).not.toBeNull();
  });

  it("abre o menu e marca a opção ativa com aria-current", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Tema — Sistema" }));

    const options = screen.getAllByRole("button", { name: /Sistema|Claro|Escuro/ });
    const activeOption = options.find((el) => el.getAttribute("aria-current") === "true");
    expect(activeOption?.textContent).toBe("Sistema");
  });

  it("selecionar uma opção chama setPreference e fecha o menu", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Tema — Sistema" }));
    fireEvent.click(screen.getByText("Escuro"));

    expect(useThemeStore.getState().preference).toBe("dark");
    expect(useThemeStore.getState().resolved).toBe("dark");
    expect(screen.queryByText("Claro")).toBeNull();
  });

  it("fecha o menu ao clicar fora dele", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Tema — Sistema" }));
    expect(screen.getByText("Escuro")).not.toBeNull();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByText("Escuro")).toBeNull();
  });
});
