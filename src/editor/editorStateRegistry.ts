import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { markdownDecorations } from "./markdownDecorations";
import { markdownEditingKeymap } from "./markdownCommands";
import { createEditorCompletion } from "./slashMenu";
import { editorTheme } from "./editorTheme";
import { searchExtensions } from "./searchExtensions";
import { useDocumentStore } from "../store/documentStore";

const states = new Map<string, EditorState>();
const scrollTops = new Map<string, number>();
const cursors = new Map<string, number>();
const positionListeners = new Set<() => void>();

// Nível do preview inline (#12 vs #29) vive num Compartment pra poder ser
// trocado em runtime sem recriar o estado (undo/redo e seleção preservados).
const livePreviewCompartment = new Compartment();
let hideMarkers = false;

/** Efeito que leva um `EditorState` (ou a `EditorView` ativa, via dispatch)
 * ao nível de preview inline escolhido. */
export function livePreviewEffect(hide: boolean) {
  return livePreviewCompartment.reconfigure(markdownDecorations(hide));
}

/** Define o nível atual para estados criados/reconciliados daqui pra frente;
 * quem já está montado numa `EditorView` recebe o efeito por dispatch. */
export function setHideMarkers(hide: boolean): void {
  hideMarkers = hide;
}

function withCurrentLivePreview(state: EditorState): EditorState {
  if (livePreviewCompartment.get(state) === markdownDecorations(hideMarkers)) return state;
  return state.update({ effects: livePreviewEffect(hideMarkers) }).state;
}

function notifyPositionChange() {
  positionListeners.forEach((listener) => listener());
}

function buildExtensions(tabId: string, onChange: (value: string) => void) {
  return [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    markdown({ base: markdownLanguage }),
    livePreviewCompartment.of(markdownDecorations(hideMarkers)),
    markdownEditingKeymap,
    createEditorCompletion(() => useDocumentStore.getState().documents[tabId]?.path ?? null),
    searchExtensions,
    editorTheme,
    EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        cursors.set(tabId, update.state.selection.main.head);
        notifyPositionChange();
      }
      if (!update.docChanged) return;
      // Transações sem userEvent são sincronizações programáticas — só ecoa
      // pro store mudanças que o próprio usuário causou (digitação, paste,
      // undo/redo, comandos).
      const isUserChange = update.transactions.some((tr) => tr.annotation(Transaction.userEvent) !== undefined);
      if (isUserChange) {
        onChange(update.state.doc.toString());
      }
    }),
  ];
}

/**
 * Devolve o `EditorState` de uma aba: cria na primeira vez, ou reconcilia o
 * estado cacheado com `content` (fonte da verdade em `documentStore`) se
 * divergirem — cobre o caso de uma aba em segundo plano ter recebido
 * conteúdo externo (conflito resolvido, restauração de histórico, reload do
 * watcher) enquanto não estava com foco. Quando `content` já bate com o
 * cache (troca de aba comum, sem mudança externa — ver `saveEditorState`),
 * devolve o estado cacheado sem despachar nenhuma transação, preservando
 * undo/redo e seleção intactos.
 */
export function getOrCreateEditorState(
  tabId: string,
  content: string,
  onChange: (value: string) => void,
): EditorState {
  const cached = states.get(tabId);
  if (!cached) {
    const anchor = Math.min(cursors.get(tabId) ?? 0, content.length);
    const state = EditorState.create({
      doc: content,
      selection: { anchor },
      extensions: buildExtensions(tabId, onChange),
    });
    states.set(tabId, state);
    return state;
  }
  if (cached.doc.toString() === content) {
    const synced = withCurrentLivePreview(cached);
    if (synced !== cached) states.set(tabId, synced);
    return synced;
  }

  const reconciled = withCurrentLivePreview(
    cached.update({
      changes: { from: 0, to: cached.doc.length, insert: content },
    }).state,
  );
  states.set(tabId, reconciled);
  return reconciled;
}

/** Persiste o `EditorState` atual de uma aba antes de trocar pra outra —
 * preserva undo/redo e seleção ao voltar pra essa aba depois. */
export function saveEditorState(tabId: string, state: EditorState): void {
  states.set(tabId, state);
}

export function saveScrollTop(tabId: string, top: number): void {
  scrollTops.set(tabId, top);
  notifyPositionChange();
}

export function getScrollTop(tabId: string): number {
  return scrollTops.get(tabId) ?? 0;
}

/** Posição (offset do cursor + scrollTop) de uma aba — insumo do
 * `session.json` (#9). Vale também para abas restauradas e ainda não
 * focadas, via `seedPosition`. */
export function getPosition(tabId: string): { cursorPos: number; scrollTop: number } {
  return { cursorPos: cursors.get(tabId) ?? 0, scrollTop: scrollTops.get(tabId) ?? 0 };
}

/** Pré-popula a posição de uma aba restaurada da sessão, antes de seu
 * `EditorState` existir: `getOrCreateEditorState` usa o cursor na criação e
 * `EditorPane` aplica o scrollTop ao focar a aba. */
export function seedPosition(tabId: string, cursorPos: number, scrollTop: number): void {
  cursors.set(tabId, cursorPos);
  scrollTops.set(tabId, scrollTop);
}

/** Notifica a cada mudança de cursor/scroll de qualquer aba; devolve o unsubscribe. */
export function subscribePositions(listener: () => void): () => void {
  positionListeners.add(listener);
  return () => positionListeners.delete(listener);
}

export function discard(tabId: string): void {
  states.delete(tabId);
  scrollTops.delete(tabId);
  cursors.delete(tabId);
}
