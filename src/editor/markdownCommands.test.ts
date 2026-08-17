import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import { history, undoDepth } from "@codemirror/commands";
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  insertLink,
  listIndent,
  listOutdent,
  toggleBold,
  toggleItalic,
  wrapAsterisk,
  wrapBacktick,
  wrapTilde,
  wrapUnderscore,
} from "./markdownCommands";

function makeState(doc: string, anchor: number, head = anchor): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage }), history()],
  });
}

function run(command: StateCommand, state: EditorState): { applied: boolean; state: EditorState } {
  let nextState = state;
  const applied = command({
    state,
    dispatch: (tr) => {
      nextState = tr.state;
    },
  });
  return { applied, state: applied ? nextState : state };
}

describe("continuação de lista (Enter, via @codemirror/lang-markdown)", () => {
  it("continua lista não-ordenada ao dar Enter no fim de um item", () => {
    const state = makeState("- primeiro", 10);
    const { applied, state: next } = run(insertNewlineContinueMarkup, state);

    expect(applied).toBe(true);
    expect(next.doc.toString()).toBe("- primeiro\n- ");
  });

  it("continua lista ordenada incrementando o número", () => {
    const state = makeState("1. um", 5);
    const { state: next } = run(insertNewlineContinueMarkup, state);

    expect(next.doc.toString()).toBe("1. um\n2. ");
  });

  it("renumera os itens seguintes ao inserir um novo item ordenado no meio", () => {
    const state = makeState("1. um\n2. dois", 5);
    const { state: next } = run(insertNewlineContinueMarkup, state);

    expect(next.doc.toString()).toBe("1. um\n2. \n3. dois");
  });

  it("Enter no único item, vazio, remove o marcador imediatamente", () => {
    const state = makeState("- ", 2);
    const { state: next } = run(insertNewlineContinueMarkup, state);

    expect(next.doc.toString()).toBe("");
  });

  it("dois Enters seguidos num item vazio (não o primeiro) encerram a lista", () => {
    const state = makeState("- item\n- ", 9);

    const first = run(insertNewlineContinueMarkup, state);
    expect(first.state.doc.toString()).toBe("- item\n\n- ");

    const second = run(insertNewlineContinueMarkup, first.state);
    expect(second.state.doc.toString()).toBe("- item\n\n");
    expect(second.state.doc.toString().endsWith("- ")).toBe(false);
  });

  it("1 Enter = 1 entrada no histórico de undo", () => {
    const state = makeState("- primeiro", 10);
    const before = undoDepth(state);
    const { state: next } = run(insertNewlineContinueMarkup, state);

    expect(undoDepth(next)).toBe(before + 1);
  });
});

describe("listIndent (Tab)", () => {
  it("aninha o item atual sob o item-irmão anterior, alinhando com a coluna de conteúdo dele", () => {
    const state = makeState("- um\n- dois", 7);
    const { applied, state: next } = run(listIndent, state);

    expect(applied).toBe(true);
    expect(next.doc.toString()).toBe("- um\n  - dois");
    expect(next.selection.main.head).toBe(9);
  });

  it("lista ordenada reinicia a numeração em 1 ao aninhar", () => {
    const state = makeState("1. um\n2. dois", 9);
    const { state: next } = run(listIndent, state);

    expect(next.doc.toString()).toBe("1. um\n   1. dois");
  });

  it("não faz nada no primeiro item da lista (sem irmão anterior)", () => {
    const state = makeState("- único item", 2);
    const { applied, state: next } = run(listIndent, state);

    expect(applied).toBe(false);
    expect(next.doc.toString()).toBe("- único item");
  });

  it("1 Tab = 1 entrada no histórico de undo", () => {
    const state = makeState("- um\n- dois", 7);
    const before = undoDepth(state);
    const { state: next } = run(listIndent, state);

    expect(undoDepth(next)).toBe(before + 1);
  });
});

describe("listOutdent (Shift-Tab)", () => {
  it("promove o item atual para o nível do item-pai", () => {
    const state = makeState("- um\n  - dois", 9);
    const { applied, state: next } = run(listOutdent, state);

    expect(applied).toBe(true);
    expect(next.doc.toString()).toBe("- um\n- dois");
    expect(next.selection.main.head).toBe(7);
  });

  it("não faz nada no nível raiz (sem item-pai)", () => {
    const state = makeState("- um\n- dois", 7);
    const { applied, state: next } = run(listOutdent, state);

    expect(applied).toBe(false);
    expect(next.doc.toString()).toBe("- um\n- dois");
  });
});

describe("envolver seleção ao digitar um marcador", () => {
  it.each([
    [wrapAsterisk, "*", "*hello* world"],
    [wrapUnderscore, "_", "_hello_ world"],
    [wrapBacktick, "`", "`hello` world"],
  ] as const)("digitar %s com seleção envolve o texto selecionado", (command, _char, expected) => {
    const state = makeState("hello world", 0, 5);
    const { applied, state: next } = run(command, state);

    expect(applied).toBe(true);
    expect(next.doc.toString()).toBe(expected);
  });

  it("digitar ~ com seleção envolve com til duplo (riscado GFM válido)", () => {
    const state = makeState("hello world", 0, 5);
    const { applied, state: next } = run(wrapTilde, state);

    expect(applied).toBe(true);
    expect(next.doc.toString()).toBe("~~hello~~ world");
    expect(next.selection.main.from).toBe(2);
    expect(next.selection.main.to).toBe(7);
  });

  it("sem seleção, deixa a digitação normal acontecer (retorna false)", () => {
    const state = makeState("hello world", 3);
    const { applied, state: next } = run(wrapAsterisk, state);

    expect(applied).toBe(false);
    expect(next.doc.toString()).toBe("hello world");
  });

  it("1 wrap = 1 entrada no histórico de undo", () => {
    const state = makeState("hello world", 0, 5);
    const before = undoDepth(state);
    const { state: next } = run(wrapAsterisk, state);

    expect(undoDepth(next)).toBe(before + 1);
  });
});

describe("toggleBold / toggleItalic (Cmd+B / Cmd+I)", () => {
  it("envolve a seleção com ** ao aplicar negrito pela primeira vez", () => {
    const state = makeState("hello", 0, 5);
    const { state: next } = run(toggleBold, state);

    expect(next.doc.toString()).toBe("**hello**");
    expect(next.selection.main.from).toBe(2);
    expect(next.selection.main.to).toBe(7);
  });

  it("Cmd+B em texto já em negrito remove a formatação (toggle)", () => {
    const state = makeState("**hello**", 2, 7);
    const { state: next } = run(toggleBold, state);

    expect(next.doc.toString()).toBe("hello");
  });

  it("envolve a seleção com * ao aplicar itálico pela primeira vez", () => {
    const state = makeState("hello", 0, 5);
    const { state: next } = run(toggleItalic, state);

    expect(next.doc.toString()).toBe("*hello*");
  });

  it("Cmd+I em texto já em itálico remove a formatação (toggle)", () => {
    const state = makeState("*hello*", 1, 6);
    const { state: next } = run(toggleItalic, state);

    expect(next.doc.toString()).toBe("hello");
  });

  it("1 toggle = 1 entrada no histórico de undo", () => {
    const state = makeState("hello", 0, 5);
    const before = undoDepth(state);
    const { state: next } = run(toggleBold, state);

    expect(undoDepth(next)).toBe(before + 1);
  });
});

describe("insertLink (Cmd+K)", () => {
  it("sem seleção, insere [texto](url) com o cursor sobre 'texto'", () => {
    const state = makeState("", 0);
    const { state: next } = run(insertLink, state);

    expect(next.doc.toString()).toBe("[texto](url)");
    expect(next.selection.main.from).toBe(1);
    expect(next.selection.main.to).toBe(6);
  });

  it("com seleção, envolve como texto do link e posiciona o cursor sobre 'url'", () => {
    const state = makeState("click here", 0, 10);
    const { state: next } = run(insertLink, state);

    expect(next.doc.toString()).toBe("[click here](url)");
    expect(next.selection.main.from).toBe(13);
    expect(next.selection.main.to).toBe(16);
  });

  it("1 Cmd+K = 1 entrada no histórico de undo", () => {
    const state = makeState("", 0);
    const before = undoDepth(state);
    const { state: next } = run(insertLink, state);

    expect(undoDepth(next)).toBe(before + 1);
  });
});
