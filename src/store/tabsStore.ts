import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useDocumentStore } from "./documentStore";
import { discard as discardEditorState } from "../editor/editorStateRegistry";

export interface Tab {
  id: string;
  path: string;
  title: string;
}

interface TabsState {
  workspaceRoot: string | null;
  tabs: Tab[];
  activeTabId: string | null;
  /** Aba cujo título está em edição inline na `TabBar` — subido de estado local
   * do componente pra cá porque o menu nativo (#24) também precisa disparar a
   * mesma UI de fora da árvore React. */
  editingTabId: string | null;
  setWorkspaceRoot: (root: string) => void;
  /** Abre uma aba para `path`; se já houver uma aba aberta com esse path,
   * só a foca em vez de duplicar. */
  openTab: (path: string, opts?: { fallbackContent?: string }) => Promise<void>;
  /** Abre um seletor nativo de arquivo filtrado por `.md` (#24) e abre a
   * aba correspondente ao path escolhido. No-op se o usuário cancelar. */
  openFileDialog: () => Promise<void>;
  /** Cria uma aba nova apontando para `untitled-N.md` (primeiro nome livre
   * checado contra o conteúdo real do diretório alvo, não só as abas
   * abertas). `targetDir` default é a raiz do workspace — o explorador (#25)
   * passa a pasta clicada para criar arquivos fora da raiz. */
  newTab: (targetDir?: string) => Promise<void>;
  /** Salva, remove a aba e ativa a vizinha. Nunca deixa a lista de abas
   * vazia — fechar a última abre automaticamente uma nova. `skipFlush` pula
   * o save antes de fechar — usado pelo explorador (#25) ao excluir o
   * arquivo da aba: salvar recriaria o arquivo que acabou de ser apagado. */
  closeTab: (tabId: string, opts?: { skipFlush?: boolean }) => Promise<void>;
  /** Corrige o `path` de qualquer aba afetada por um rename feito fora da
   * `TabBar` (explorador, #25): `oldPath` exato (arquivo renomeado) ou
   * prefixo `oldPath + "/"` (aba dentro de uma pasta renomeada). Não chama
   * `rename_file` — só sincroniza o estado já refletido em disco. */
  syncPathsAfterRename: (oldPath: string, newPath: string) => void;
  setActiveTab: (tabId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  /** Renomeia o arquivo em disco (via `rename_file`) e só então atualiza a
   * aba/documento — snapshots de histórico anteriores ao rename ficam sob
   * o hash do path antigo, sem migração (ver DECISIONS.md #21). */
  renameTab: (tabId: string, newTitle: string) => Promise<void>;
  /** Entra em modo de edição inline do título da aba (duplo-clique na
   * `TabBar` ou item "Renomear" do menu nativo). */
  startRenaming: (tabId: string) => void;
  /** Sai do modo de edição sem aplicar mudança (Esc). */
  cancelRenaming: () => void;
  /** Aplica o novo título via `renameTab` e sai do modo de edição. */
  commitRenaming: (tabId: string, newTitle: string) => Promise<void>;
  /** 1-indexado e literal: Cmd+9 vai pra 9ª aba, não pra última. */
  focusTabByIndex: (n: number) => void;
  focusNextTab: () => void;
  focusPrevTab: () => void;
}

function basename(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1];
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export const useTabsStore = create<TabsState>((set, get) => ({
  workspaceRoot: null,
  tabs: [],
  activeTabId: null,
  editingTabId: null,

  setWorkspaceRoot: (root) => set({ workspaceRoot: root }),

  openTab: async (path, opts) => {
    const existing = get().tabs.find((tab) => tab.path === path);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    const id = crypto.randomUUID();
    const title = basename(path);
    set((state) => ({ tabs: [...state.tabs, { id, path, title }], activeTabId: id }));
    await useDocumentStore.getState().initDocument(id, path, opts?.fallbackContent);
  },

  openFileDialog: async () => {
    const { workspaceRoot } = get();
    const path = await open({
      title: "Abrir arquivo",
      filters: [{ name: "Markdown", extensions: ["md"] }],
      defaultPath: workspaceRoot ?? undefined,
      multiple: false,
      directory: false,
    });
    if (typeof path === "string") await get().openTab(path);
  },

  newTab: async (targetDir) => {
    const { workspaceRoot } = get();
    const dir = targetDir ?? workspaceRoot;
    if (dir === null) return;

    const existingNames = new Set(await invoke<string[]>("list_dir", { path: dir }));

    let candidate = "untitled.md";
    let n = 1;
    while (existingNames.has(candidate)) {
      candidate = `untitled-${n}.md`;
      n += 1;
    }

    await get().openTab(`${dir}/${candidate}`);
  },

  closeTab: async (tabId, opts) => {
    if (!opts?.skipFlush) await useDocumentStore.getState().flush(tabId);

    const { tabs, activeTabId } = get();
    const index = tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1) return;

    const remaining = tabs.filter((tab) => tab.id !== tabId);
    let nextActiveTabId = activeTabId;
    if (activeTabId === tabId) {
      const neighbor = remaining[index] ?? remaining[index - 1] ?? null;
      nextActiveTabId = neighbor ? neighbor.id : null;
    }

    set({ tabs: remaining, activeTabId: nextActiveTabId });
    useDocumentStore.getState().removeDocument(tabId);
    discardEditorState(tabId);

    if (remaining.length === 0) {
      await get().newTab();
    }
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  reorderTabs: (fromIndex, toIndex) => {
    set((state) => {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      if (!moved) return {};
      tabs.splice(toIndex, 0, moved);
      return { tabs };
    });
  },

  renameTab: async (tabId, newTitle) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const normalizedTitle = newTitle.endsWith(".md") ? newTitle : `${newTitle}.md`;
    if (normalizedTitle === tab.title) return;

    await useDocumentStore.getState().flush(tabId);

    const dir = dirname(tab.path);
    const newPath = dir ? `${dir}/${normalizedTitle}` : normalizedTitle;

    try {
      await invoke("rename_file", { from: tab.path, to: newPath });
    } catch (err) {
      console.error("falha ao renomear a aba:", err);
      return;
    }

    useDocumentStore.getState().renameDocument(tabId, newPath);
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, path: newPath, title: normalizedTitle } : t)),
    }));
  },

  syncPathsAfterRename: (oldPath, newPath) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.path === oldPath) {
          const newTabPath = newPath;
          useDocumentStore.getState().renameDocument(tab.id, newTabPath);
          return { ...tab, path: newTabPath, title: basename(newTabPath) };
        }
        if (tab.path.startsWith(`${oldPath}/`)) {
          const newTabPath = newPath + tab.path.slice(oldPath.length);
          useDocumentStore.getState().renameDocument(tab.id, newTabPath);
          return { ...tab, path: newTabPath };
        }
        return tab;
      }),
    }));
  },

  startRenaming: (tabId) => set({ editingTabId: tabId }),

  cancelRenaming: () => set({ editingTabId: null }),

  commitRenaming: async (tabId, newTitle) => {
    set({ editingTabId: null });
    if (newTitle.trim()) await get().renameTab(tabId, newTitle.trim());
  },

  focusTabByIndex: (n) => {
    const tab = get().tabs[n - 1];
    if (tab) set({ activeTabId: tab.id });
  },

  focusNextTab: () => {
    const { tabs, activeTabId } = get();
    if (tabs.length === 0) return;
    const index = tabs.findIndex((tab) => tab.id === activeTabId);
    const nextIndex = index === -1 ? 0 : (index + 1) % tabs.length;
    set({ activeTabId: tabs[nextIndex].id });
  },

  focusPrevTab: () => {
    const { tabs, activeTabId } = get();
    if (tabs.length === 0) return;
    const index = tabs.findIndex((tab) => tab.id === activeTabId);
    const prevIndex = index === -1 ? 0 : (index - 1 + tabs.length) % tabs.length;
    set({ activeTabId: tabs[prevIndex].id });
  },
}));
