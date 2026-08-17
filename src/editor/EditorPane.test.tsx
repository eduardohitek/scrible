import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorPane } from "./EditorPane";

describe("EditorPane", () => {
  it("sincroniza o conteúdo do editor quando `value` muda por fora da digitação (#45)", async () => {
    const { container, rerender } = render(<EditorPane value="" onChange={() => {}} />);

    await waitFor(() => {
      expect(container.querySelector(".cm-content")).not.toBeNull();
    });

    rerender(<EditorPane value="conteúdo carregado" onChange={() => {}} />);

    await waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toBe("conteúdo carregado");
    });
  });

  it("resincronizar `value` não dispara onChange de volta (evita loop de autosave espúrio)", async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<EditorPane value="inicial" onChange={onChange} />);

    await waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toBe("inicial");
    });

    rerender(<EditorPane value="restaurado do histórico" onChange={onChange} />);

    await waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toBe("restaurado do histórico");
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
