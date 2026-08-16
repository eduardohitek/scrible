import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

const AUTOSAVE_DEBOUNCE_MS = 800;

const DEFAULT_DOCUMENT = `# scrible

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

interface WorkspacePaths {
  root: string;
  hidden: string;
}

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

interface DocumentState {
  path: string | null;
  content: string;
  lastSavedMtime: number | null;
  status: DocumentStatus;
  conflict: DocumentConflict | null;
  /** `true` desde a última edição não salva; `false` assim que o conteúdo
   * bate com o que está em disco (save bem-sucedido ou reload externo). */
  dirty: boolean;
  init: () => Promise<void>;
  setContent: (value: string) => void;
  flush: () => Promise<void>;
  applyExternalContent: (content: string, mtime: number) => void;
  /** Chamado ao receber o evento `external-file-changed` do watcher (#10):
   * reload silencioso se não há edição local pendente, ou expõe o conflito
   * pra `ConflictBanner` se houver. */
  handleExternalChange: (content: string, mtime: number) => void;
  /** Resolve um conflito ativo: "mine" sobrescreve o disco com o conteúdo
   * local; "disk" descarta o conteúdo local (preservado antes via snapshot
   * forçado) e adota a versão do disco. */
  resolveConflict: (choice: "mine" | "disk") => Promise<void>;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingSave() {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

async function performSave(get: () => DocumentState, set: (partial: Partial<DocumentState>) => void) {
  const { path, content, lastSavedMtime } = get();
  if (path === null) return;

  set({ status: "saving" });
  try {
    const newMtime = await invoke<number>("save_file", {
      path,
      content,
      expectedMtime: lastSavedMtime,
    });
    set({ lastSavedMtime: newMtime, status: "idle", dirty: false });
  } catch (err) {
    const fsError = err as FsError;
    if (fsError.kind === "ExternalChange") {
      set({
        status: "conflict",
        conflict: {
          currentMtime: fsError.current_mtime,
          currentContent: fsError.current_content,
        },
      });
    } else {
      console.error("falha ao salvar o documento:", fsError);
      set({ status: "error" });
    }
  }
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  path: null,
  content: "",
  lastSavedMtime: null,
  status: "idle",
  conflict: null,
  dirty: false,

  init: async () => {
    const { root } = await invoke<WorkspacePaths>("workspace_status");
    const path = `${root}/untitled.md`;

    try {
      const content = await invoke<string>("read_file", { path });
      set({ path, content, status: "idle" });
    } catch (err) {
      const fsError = err as FsError;
      if (fsError.kind !== "NotFound") {
        console.error("falha ao abrir o documento padrão:", fsError);
        set({ path, status: "error" });
        return;
      }
      const newMtime = await invoke<number>("save_file", {
        path,
        content: DEFAULT_DOCUMENT,
        expectedMtime: null,
      });
      set({ path, content: DEFAULT_DOCUMENT, lastSavedMtime: newMtime, status: "idle" });
    }
  },

  setContent: (value) => {
    set({ content: value, dirty: true });
    clearPendingSave();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void performSave(get, set);
    }, AUTOSAVE_DEBOUNCE_MS);
  },

  flush: async () => {
    clearPendingSave();
    await performSave(get, set);
  },

  applyExternalContent: (content, mtime) => {
    clearPendingSave();
    set({ content, lastSavedMtime: mtime, status: "idle", conflict: null, dirty: false });
  },

  handleExternalChange: (content, mtime) => {
    const { dirty, applyExternalContent } = get();
    if (!dirty) {
      applyExternalContent(content, mtime);
      return;
    }
    set({
      status: "conflict",
      conflict: { currentMtime: mtime, currentContent: content },
    });
  },

  resolveConflict: async (choice) => {
    const { conflict, path, content, applyExternalContent } = get();
    if (!conflict || path === null) return;

    if (choice === "disk") {
      await invoke("snapshot_before_discard", { path, content });
      applyExternalContent(conflict.currentContent, conflict.currentMtime);
      return;
    }

    set({ lastSavedMtime: conflict.currentMtime, conflict: null });
    await performSave(get, set);
  },
}));
