import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O CodeMirror lê `navigator.platform` ao carregar `@codemirror/view`, por isso
// cada plataforma tem um arquivo de teste próprio, com o valor definido antes
// dos imports.
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", { value: "Linux x86_64", configurable: true });
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { createView, describeDuplicateLine, press, resetView } from "./duplicateLine.testHelpers";

describeDuplicateLine("Ctrl+Shift", { ctrlKey: true, shiftKey: true });
describeDuplicateLine("Shift+Alt", { altKey: true, shiftKey: true });

describe("atalhos de duplicar linha no Linux", () => {
  beforeEach(resetView);
  afterEach(resetView);

  it("Ctrl+Shift+seta não seleciona no lugar de duplicar", () => {
    const target = createView("um\ndois", 1);

    press(target, "ArrowDown", { ctrlKey: true, shiftKey: true });

    expect(target.state.selection.main.empty).toBe(true);
  });
});
