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

/** `missing`: o arquivo foi apagado, renomeado ou movido por outro programa
 * (#141). O autosave fica suspenso até o usuário recriar o arquivo
 * (`restoreMissing`) ou o arquivo reaparecer no mesmo path. */
export type DocumentStatus = "idle" | "saving" | "conflict" | "error" | "missing";

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

/** Último reload causado por alteração externa (#142). `seq` cresce a cada
 * reload, para que dois reloads seguidos da mesma aba sejam distinguíveis. */
export interface ExternalReload {
  tabId: string;
  seq: number;
}

interface DocumentStoreState {
  documents: Record<string, DocumentEntry>;
  /** Preenchido só pelo caminho de reload de `handleExternalChange`, quando o
   * conteúdo realmente mudou. A status bar usa esse campo para mostrar
   * "Recarregado do disco". */
  lastExternalReload: ExternalReload | null;
  /** Abre (ou recarrega) o documento de uma aba: lê `path`; se não existir,
   * cria com `fallbackContent` (só a aba inicial recebe o texto de boas-vindas). */
  initDocument: (tabId: string, path: string, fallbackContent?: string) => Promise<void>;
  setContent: (tabId: string, value: string) => void;
  flush: (tabId: string) => Promise<void>;
  /** Salva imediatamente todos os documentos com debounce pendente — usado em
   * blur da janela e fechamento do app, onde não dá pra esperar por tabId. */
  flushAll: () => Promise<void>;
  applyExternalContent: (tabId: string, content: string, mtime: number) => void;
  /** Chamado ao receber o evento `external-file-changed` do watcher (#10,
   * #140): reload silencioso se não há edição local pendente, ou expõe o
   * conflito pra `ConflictBanner` se houver. Conteúdo em disco igual ao local
   * só adota o mtime novo (ex.: `touch`, ou o outro programa gravou o mesmo
   * texto) — sem reload nem conflito. */
  handleExternalChange: (tabId: string, content: string, mtime: number) => void;
  /** Resolve um conflito ativo: "mine" sobrescreve o disco com o conteúdo
   * local; "disk" descarta o conteúdo local (preservado antes via snapshot
   * forçado) e adota a versão do disco. */
  resolveConflict: (tabId: string, choice: "mine" | "disk") => Promise<void>;
  /** Evento `external-file-removed` do watcher (#141): marca a aba como
   * `missing` e suspende o autosave, sem tocar no conteúdo em memória. */
  handleExternalRemoval: (tabId: string) => void;
  /** "Salvar de novo aqui" (#141): recria o arquivo no mesmo path com o
   * conteúdo atual. Devolve `false` (e a aba continua `missing`) se a
   * gravação falhar — ex.: a pasta também sumiu. */
  restoreMissing: (tabId: string) => Promise<boolean>;
  /** Só atualiza o path após um rename bem-sucedido em disco — não mexe em
   * content/lastSavedMtime, que continuam válidos (mesmo arquivo, novo nome). */
  renameDocument: (tabId: string, newPath: string) => void;
  /** Reaponta o documento para um arquivo recém-gravado em outro path
   * (Salvar Como, #127): adota `newPath`/`mtime` e só fica limpo se o
   * conteúdo não mudou desde `writtenContent` (edição durante a gravação
   * continua pendente). */
  relocateDocument: (tabId: string, newPath: string, mtime: number, writtenContent: string) => void;
  removeDocument: (tabId: string) => void;
  /** Suspende o autosave da aba (Salvar Como, #127): edições continuam
   * atualizando `content`/`dirty`, mas nada é gravado até `resumeAutosave`
   * — senão um autosave durante a cópia gravaria no path antigo. */
  pauseAutosave: (tabId: string) => void;
  /** Volta a gravar; se houver edição pendente, reagenda o debounce (contra
   * o path atual do documento, que pode ter mudado durante a pausa). */
  resumeAutosave: (tabId: string) => void;
}

let externalReloadSeq = 0;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pausedTabs = new Set<string>();

/** `true` enquanto a aba está com o autosave suspenso (Salvar Como em
 * andamento, #127). A checagem por foco (#143) não mexe nessas abas. */
export function isAutosavePaused(tabId: string): boolean {
  return pausedTabs.has(tabId);
}

function scheduleSave(
  tabId: string,
  get: () => DocumentStoreState,
  set: (fn: (state: DocumentStoreState) => Partial<DocumentStoreState>) => void,
) {
  clearPendingSave(tabId);
  if (pausedTabs.has(tabId)) return;
  const timer = setTimeout(() => {
    debounceTimers.delete(tabId);
    void performSave(tabId, get, set);
  }, AUTOSAVE_DEBOUNCE_MS);
  debounceTimers.set(tabId, timer);
}

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
  if (pausedTabs.has(tabId)) return;
  const entry = get().documents[tabId];
  if (!entry || entry.path === null || entry.status === "missing") return;
  const { path, content, lastSavedMtime } = entry;
  // O documento pode ser reapontado (Salvar Como) enquanto a gravação está
  // em voo: o resultado vale para o path antigo e não pode ser aplicado.
  const stillSamePath = () => get().documents[tabId]?.path === path;

  patchDocument(set, tabId, { status: "saving" });
  try {
    const newMtime = await invoke<number>("save_file", {
      path,
      content,
      expectedMtime: lastSavedMtime,
    });
    if (!stillSamePath()) return;
    patchDocument(set, tabId, {
      lastSavedMtime: newMtime,
      status: "idle",
      dirty: get().documents[tabId].content !== content,
    });
  } catch (err) {
    if (!stillSamePath()) return;
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
  lastExternalReload: null,

  initDocument: async (tabId, path, fallbackContent = "") => {
    try {
      // O mtime da leitura vira `lastSavedMtime` (#143): sem ele, a checagem
      // por foco e o primeiro autosave não teriam com o que comparar.
      const { content, mtime } = await invoke<{ content: string; mtime: number }>("read_file_with_mtime", {
        path,
      });
      set((state) => ({
        documents: {
          ...state.documents,
          [tabId]: {
            path,
            content,
            lastSavedMtime: mtime,
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
    scheduleSave(tabId, get, set);
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
    if (!entry.dirty || content === entry.content) {
      const changed = content !== entry.content;
      get().applyExternalContent(tabId, content, mtime);
      if (changed) set({ lastExternalReload: { tabId, seq: ++externalReloadSeq } });
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

  handleExternalRemoval: (tabId) => {
    if (!get().documents[tabId]) return;
    clearPendingSave(tabId);
    patchDocument(set, tabId, { status: "missing", conflict: null });
  },

  restoreMissing: async (tabId) => {
    const entry = get().documents[tabId];
    if (!entry || entry.status !== "missing" || entry.path === null) return false;
    const { path, content } = entry;
    try {
      const mtime = await invoke<number>("save_file", { path, content, expectedMtime: null });
      if (get().documents[tabId]?.path !== path) return false;
      patchDocument(set, tabId, {
        lastSavedMtime: mtime,
        status: "idle",
        conflict: null,
        dirty: get().documents[tabId].content !== content,
      });
      if (get().documents[tabId].dirty) scheduleSave(tabId, get, set);
      return true;
    } catch (err) {
      console.error("falha ao recriar o arquivo removido:", err);
      return false;
    }
  },

  renameDocument: (tabId, newPath) => {
    patchDocument(set, tabId, { path: newPath });
  },

  relocateDocument: (tabId, newPath, mtime, writtenContent) => {
    const entry = get().documents[tabId];
    if (!entry) return;
    patchDocument(set, tabId, {
      path: newPath,
      lastSavedMtime: mtime,
      status: "idle",
      conflict: null,
      dirty: entry.content !== writtenContent,
    });
  },

  pauseAutosave: (tabId) => {
    pausedTabs.add(tabId);
    clearPendingSave(tabId);
  },

  resumeAutosave: (tabId) => {
    pausedTabs.delete(tabId);
    if (get().documents[tabId]?.dirty) scheduleSave(tabId, get, set);
  },

  removeDocument: (tabId) => {
    pausedTabs.delete(tabId);
    clearPendingSave(tabId);
    set((state) => {
      const documents = { ...state.documents };
      delete documents[tabId];
      return { documents };
    });
  },
}));
