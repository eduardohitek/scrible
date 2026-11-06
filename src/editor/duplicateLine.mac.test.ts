import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O CodeMirror lê `navigator.platform` ao carregar `@codemirror/view`, por isso
// cada plataforma tem um arquivo de teste próprio, com o valor definido antes
// dos imports.
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { createView, describeDuplicateLine, press, resetView } from "./duplicateLine.testHelpers";

describeDuplicateLine("⇧⌥", { altKey: true, shiftKey: true });

describe("atalhos que continuam iguais no macOS", () => {
  beforeEach(resetView);
  afterEach(resetView);

  it("⇧⌘↓ seleciona até o fim do documento, sem duplicar", () => {
    const target = createView("um\ndois", 1);

    press(target, "ArrowDown", { metaKey: true, shiftKey: true });

    expect(target.state.doc.toString()).toBe("um\ndois");
    expect(target.state.selection.main.from).toBe(1);
    expect(target.state.selection.main.to).toBe(7);
  });

  it("⇧⌘↑ seleciona até o início do documento, sem duplicar", () => {
    const target = createView("um\ndois", 4);

    press(target, "ArrowUp", { metaKey: true, shiftKey: true });

    expect(target.state.doc.toString()).toBe("um\ndois");
    expect(target.state.selection.main.from).toBe(0);
    expect(target.state.selection.main.to).toBe(4);
  });

  it("Ctrl+Shift+seta não duplica", () => {
    const target = createView("um\ndois", 1);

    press(target, "ArrowDown", { ctrlKey: true, shiftKey: true });

    expect(target.state.doc.toString()).toBe("um\ndois");
  });
});
