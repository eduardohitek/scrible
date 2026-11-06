import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { discard, getOrCreateEditorState } from "./editorStateRegistry";

export type Modifiers = Pick<KeyboardEventInit, "shiftKey" | "altKey" | "ctrlKey" | "metaKey">;

const TAB_ID = "duplicate-line-test";

let view: EditorView | null = null;

/** Usa as extensões reais do editor (`getOrCreateEditorState`), para o teste
 * pegar o keymap inteiro, com as precedências de verdade. */
export function createView(doc: string, anchor: number, head = anchor): EditorView {
  const state = getOrCreateEditorState(TAB_ID, doc, () => {});
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({ state, parent });
  view.dispatch({ selection: EditorSelection.single(anchor, head) });
  return view;
}

export function press(target: EditorView, key: "ArrowUp" | "ArrowDown", modifiers: Modifiers): void {
  target.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }));
}

export function resetView(): void {
  view?.destroy();
  view = null;
  discard(TAB_ID);
}

/** Comportamento comum aos atalhos de duplicar linha em qualquer plataforma. */
export function describeDuplicateLine(label: string, modifiers: Modifiers): void {
  describe(`duplicar linha com ${label}`, () => {
    beforeEach(resetView);
    afterEach(resetView);

    it("sem seleção, duplica para baixo com o cursor na cópia de baixo", () => {
      const target = createView("um\ndois", 1);

      press(target, "ArrowDown", modifiers);

      expect(target.state.doc.toString()).toBe("um\num\ndois");
      expect(target.state.selection.main.head).toBe(4);
    });

    it("sem seleção, duplica para cima com o cursor na cópia de cima", () => {
      const target = createView("um\ndois", 4);

      press(target, "ArrowUp", modifiers);

      expect(target.state.doc.toString()).toBe("um\ndois\ndois");
      expect(target.state.selection.main.head).toBe(4);
    });

    it("duplica a última linha, mesmo sem quebra de linha no fim do documento", () => {
      const target = createView("um\ndois", 7);

      press(target, "ArrowDown", modifiers);

      expect(target.state.doc.toString()).toBe("um\ndois\ndois");
    });

    it("seleção de várias linhas duplica o bloco inteiro", () => {
      const target = createView("um\ndois\ntres", 1, 4);

      press(target, "ArrowDown", modifiers);

      expect(target.state.doc.toString()).toBe("um\ndois\num\ndois\ntres");
    });

    it("vários cursores duplicam cada linha", () => {
      const target = createView("um\ndois\ntres", 0);
      // O editor não liga vários cursores hoje; o atalho precisa funcionar se ligar.
      target.dispatch({ effects: StateEffect.appendConfig.of(EditorState.allowMultipleSelections.of(true)) });
      target.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(8)]) });

      press(target, "ArrowDown", modifiers);

      expect(target.state.doc.toString()).toBe("um\num\ndois\ntres\ntres");
    });

    it("um único desfazer remove a duplicação", () => {
      const target = createView("um\ndois", 1);

      press(target, "ArrowDown", modifiers);
      undo(target);

      expect(target.state.doc.toString()).toBe("um\ndois");
    });
  });
}
