import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

const AUTOSAVE_DEBOUNCE_MS = 800;

export const DEFAULT_DOCUMENT = `# scrible

Um editor de **markdown** com preview em tempo real, para macOS.

## Recursos

- [x] Edição com CodeMirror 6
- [x] Preview com markdown-it
- [ ] Autocomplete de sintaxe

\`\`\`mermaid
flowchart TD
    A[Editor] --> B[Preview]
    B --> C{Mermaid ok?}
    C -->|Sim| D[🎉]
\`\`\`
`;

interface FsErrorNotFound {
  kind: "NotFound";
  path: string;
}
interface FsErrorPermissionDenied {
  kind: "PermissionDenied";
  path: string;
}
interface FsErrorIo {
  kind: "Io";
  message: string;
}
interface FsErrorExternalChange {
  kind: "ExternalChange";
  current_mtime: number;
  current_content: string;
}
type FsError = FsErrorNotFound | FsErrorPermissionDenied | FsErrorIo | FsErrorExternalChange;

export type DocumentStatus = "idle" | "saving" | "conflict" | "error";

interface DocumentConflict {
  currentMtime: number;
  currentContent: string;
}

export interface DocumentEntry {
  path: string | null;
  content: string;
  lastSavedMtime: number | null;
  status: DocumentStatus;
  /** `true` desde a última edição não salva; `false` assim que o conteúdo
   * bate com o que está em disco (save bem-sucedido ou reload externo). */
  dirty: boolean;
  conflict: DocumentConflict | null;
}

interface DocumentStoreState {
  documents: Record<string, DocumentEntry>;
  /** Abre (ou recarrega) o documento de uma aba: lê `path`; se não existir,
   * cria com `fallbackContent` (só a aba inicial recebe o texto de boas-vindas). */
  initDocument: (tabId: string, path: string, fallbackContent?: string) => Promise<void>;
  setContent: (tabId: string, value: string) => void;
  flush: (tabId: string) => Promise<void>;
  /** Salva imediatamente todos os documentos com debounce pendente — usado em
   * blur da janela e fechamento do app, onde não dá pra esperar por tabId. */
  flushAll: () => Promise<void>;
  applyExternalContent: (tabId: string, content: string, mtime: number) => void;
  /** Chamado ao receber o evento `external-file-changed` do watcher (#10):
   * reload silencioso se não há edição local pendente, ou expõe o conflito
   * pra `ConflictBanner` se houver. */
  handleExternalChange: (tabId: string, content: string, mtime: number) => void;
  /** Resolve um conflito ativo: "mine" sobrescreve o disco com o conteúdo
   * local; "disk" descarta o conteúdo local (preservado antes via snapshot
   * forçado) e adota a versão do disco. */
  resolveConflict: (tabId: string, choice: "mine" | "disk") => Promise<void>;
  /** Só atualiza o path após um rename bem-sucedido em disco — não mexe em
   * content/lastSavedMtime, que continuam válidos (mesmo arquivo, novo nome). */
  renameDocument: (tabId: string, newPath: string) => void;
  removeDocument: (tabId: string) => void;
}

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearPendingSave(tabId: string) {
  const timer = debounceTimers.get(tabId);
  if (timer !== undefined) {
    clearTimeout(timer);
    debounceTimers.delete(tabId);
  }
}

function patchDocument(
  set: (fn: (state: DocumentStoreState) => Partial<DocumentStoreState>) => void,
  tabId: string,
  patch: Partial<DocumentEntry>,
) {
  set((state) => ({
    documents: {
      ...state.documents,
      [tabId]: { ...state.documents[tabId], ...patch },
    },
  }));
}

async function performSave(
  tabId: string,
  get: () => DocumentStoreState,
  set: (fn: (state: DocumentStoreState) => Partial<DocumentStoreState>) => void,
) {
  const entry = get().documents[tabId];
  if (!entry || entry.path === null) return;
  const { path, content, lastSavedMtime } = entry;

  patchDocument(set, tabId, { status: "saving" });
  try {
    const newMtime = await invoke<number>("save_file", {
      path,
      content,
      expectedMtime: lastSavedMtime,
    });
    patchDocument(set, tabId, { lastSavedMtime: newMtime, status: "idle", dirty: false });
  } catch (err) {
    const fsError = err as FsError;
    if (fsError.kind === "ExternalChange") {
      patchDocument(set, tabId, {
        status: "conflict",
        conflict: {
          currentMtime: fsError.current_mtime,
          currentContent: fsError.current_content,
        },
      });
    } else {
      console.error("falha ao salvar o documento:", fsError);
      patchDocument(set, tabId, { status: "error" });
    }
  }
}

export const useDocumentStore = create<DocumentStoreState>((set, get) => ({
  documents: {},

  initDocument: async (tabId, path, fallbackContent = "") => {
    try {
      const content = await invoke<string>("read_file", { path });
      set((state) => ({
        documents: {
          ...state.documents,
          [tabId]: {
            path,
            content,
            lastSavedMtime: state.documents[tabId]?.lastSavedMtime ?? null,
            status: "idle",
            conflict: null,
            dirty: false,
          },
        },
      }));
    } catch (err) {
      const fsError = err as FsError;
      if (fsError.kind !== "NotFound") {
        console.error("falha ao abrir o documento:", fsError);
        set((state) => ({
          documents: {
            ...state.documents,
            [tabId]: {
              path,
              content: "",
              lastSavedMtime: null,
              status: "error",
              conflict: null,
              dirty: false,
            },
          },
        }));
        return;
      }
      const newMtime = await invoke<number>("save_file", {
        path,
        content: fallbackContent,
        expectedMtime: null,
      });
      set((state) => ({
        documents: {
          ...state.documents,
          [tabId]: {
            path,
            content: fallbackContent,
            lastSavedMtime: newMtime,
            status: "idle",
            conflict: null,
            dirty: false,
          },
        },
      }));
    }
  },

  setContent: (tabId, value) => {
    patchDocument(set, tabId, { content: value, dirty: true });
    clearPendingSave(tabId);
    const timer = setTimeout(() => {
      debounceTimers.delete(tabId);
      void performSave(tabId, get, set);
    }, AUTOSAVE_DEBOUNCE_MS);
    debounceTimers.set(tabId, timer);
  },

  flush: async (tabId) => {
    clearPendingSave(tabId);
    await performSave(tabId, get, set);
  },

  flushAll: async () => {
    const tabIds = Object.keys(get().documents);
    await Promise.all(
      tabIds.map((tabId) => {
        clearPendingSave(tabId);
        return performSave(tabId, get, set);
      }),
    );
  },

  applyExternalContent: (tabId, content, mtime) => {
    clearPendingSave(tabId);
    patchDocument(set, tabId, { content, lastSavedMtime: mtime, status: "idle", conflict: null, dirty: false });
  },

  handleExternalChange: (tabId, content, mtime) => {
    const entry = get().documents[tabId];
    if (!entry) return;
    if (!entry.dirty) {
      get().applyExternalContent(tabId, content, mtime);
      return;
    }
    patchDocument(set, tabId, {
      status: "conflict",
      conflict: { currentMtime: mtime, currentContent: content },
    });
  },

  resolveConflict: async (tabId, choice) => {
    const entry = get().documents[tabId];
    if (!entry || !entry.conflict || entry.path === null) return;
    const { conflict, path, content } = entry;

    if (choice === "disk") {
      await invoke("snapshot_before_discard", { path, content });
      get().applyExternalContent(tabId, conflict.currentContent, conflict.currentMtime);
      return;
    }

    patchDocument(set, tabId, { lastSavedMtime: conflict.currentMtime, conflict: null });
    await performSave(tabId, get, set);
  },

  renameDocument: (tabId, newPath) => {
    patchDocument(set, tabId, { path: newPath });
  },

  removeDocument: (tabId) => {
    clearPendingSave(tabId);
    set((state) => {
      const documents = { ...state.documents };
      delete documents[tabId];
      return { documents };
    });
  },
}));
