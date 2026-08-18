import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle";
import { useThemeStore } from "./themeStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    useThemeStore.setState({
      settingsPath: "/tmp/settings.json",
      preference: "system",
      resolved: "light",
    });
  });

  it("mostra a preferência atual no botão", () => {
    render(<ThemeToggle />);
    expect(screen.getByText("Sistema")).not.toBeNull();
  });

  it("abre o menu e marca a opção ativa com aria-current", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByText("Sistema"));

    const options = screen.getAllByRole("button", { name: /Sistema|Claro|Escuro/ });
    const activeOption = options.find((el) => el.getAttribute("aria-current") === "true");
    expect(activeOption?.textContent).toBe("Sistema");
  });

  it("selecionar uma opção chama setPreference e fecha o menu", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByText("Sistema"));
    fireEvent.click(screen.getByText("Escuro"));

    expect(useThemeStore.getState().preference).toBe("dark");
    expect(useThemeStore.getState().resolved).toBe("dark");
    expect(screen.queryByText("Claro")).toBeNull();
  });

  it("fecha o menu ao clicar fora dele", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByText("Sistema"));
    expect(screen.getByText("Escuro")).not.toBeNull();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByText("Escuro")).toBeNull();
  });
});
