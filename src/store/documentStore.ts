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
  init: () => Promise<void>;
  setContent: (value: string) => void;
  flush: () => Promise<void>;
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
    set({ lastSavedMtime: newMtime, status: "idle" });
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
    set({ content: value });
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
}));
