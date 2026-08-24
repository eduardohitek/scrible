import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useClickOutside } from "./useClickOutside";

function renderWithNode(onClose: () => void, enabled: boolean) {
  const node = document.createElement("div");
  document.body.appendChild(node);
  const ref = { current: node };
  const view = renderHook(() => useClickOutside(ref, onClose, enabled));
  return { node, ...view };
}

describe("useClickOutside", () => {
  it("chama onClose ao clicar fora do elemento referenciado", () => {
    const onClose = vi.fn();
    const { node } = renderWithNode(onClose, true);

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onClose).toHaveBeenCalledOnce();
    node.remove();
  });

  it("não chama onClose ao clicar dentro do elemento referenciado", () => {
    const onClose = vi.fn();
    const { node } = renderWithNode(onClose, true);

    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
    node.remove();
  });

  it("chama onClose ao pressionar Escape", () => {
    const onClose = vi.fn();
    const { node } = renderWithNode(onClose, true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onClose).toHaveBeenCalledOnce();
    node.remove();
  });

  it("não registra listeners quando enabled é false", () => {
    const onClose = vi.fn();
    const { node } = renderWithNode(onClose, false);

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onClose).not.toHaveBeenCalled();
    node.remove();
  });

  it("remove os listeners no cleanup (unmount não dispara mais onClose)", () => {
    const onClose = vi.fn();
    const { node, unmount } = renderWithNode(onClose, true);

    unmount();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
    node.remove();
  });
});
