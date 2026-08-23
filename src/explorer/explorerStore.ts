import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { loadAppSettings, patchAppSettings } from "../settings/appSettings";
import { useTabsStore } from "../store/tabsStore";
import { DEFAULT_EXPLORER_WIDTH_PX } from "./constants";

export interface ExplorerEntry {
  name: string;
  isDir: boolean;
}

interface ExplorerState {
  workspaceRoot: string | null;
  visible: boolean;
  width: number;
  expandedDirs: Set<string>;
  entriesByDir: Record<string, ExplorerEntry[]>;
  init: (workspaceRoot: string) => Promise<void>;
  toggle: () => void;
  setWidth: (px: number) => Promise<void>;
  toggleDir: (path: string) => Promise<void>;
  refreshDir: (path: string) => Promise<void>;
  refreshVisible: () => Promise<void>;
  createFile: (dirPath: string) => Promise<void>;
  createFolder: (dirPath: string) => Promise<void>;
  renameEntry: (oldPath: string, newName: string, isDir: boolean) => Promise<void>;
  deleteEntry: (path: string, isDir: boolean) => Promise<void>;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  workspaceRoot: null,
  visible: true,
  width: DEFAULT_EXPLORER_WIDTH_PX,
  expandedDirs: new Set(),
  entriesByDir: {},

  init: async (workspaceRoot) => {
    const settings = await loadAppSettings();
    set({ workspaceRoot, visible: settings.explorer.visible, width: settings.explorer.width });
    await get().refreshDir(workspaceRoot);
  },

  toggle: () => {
    const visible = !get().visible;
    set({ visible });
    patchAppSettings({ explorer: { visible, width: get().width } }).catch((err: unknown) => {
      console.error("falha ao persistir visibilidade do explorador:", err);
    });
  },

  setWidth: async (px) => {
    set({ width: px });
    try {
      await patchAppSettings({ explorer: { visible: get().visible, width: px } });
    } catch (err) {
      console.error("falha ao persistir largura do explorador:", err);
    }
  },

  toggleDir: async (path) => {
    const isExpanded = get().expandedDirs.has(path);
    set((state) => {
      const next = new Set(state.expandedDirs);
      if (isExpanded) next.delete(path);
      else next.add(path);
      return { expandedDirs: next };
    });
    if (!isExpanded && !get().entriesByDir[path]) {
      await get().refreshDir(path);
    }
  },

  refreshDir: async (path) => {
    try {
      const entries = await invoke<ExplorerEntry[]>("list_dir_entries", { path });
      set((state) => ({ entriesByDir: { ...state.entriesByDir, [path]: entries } }));
    } catch (err) {
      console.error("falha ao listar pasta no explorador:", err);
    }
  },

  refreshVisible: async () => {
    const { workspaceRoot, expandedDirs } = get();
    if (!workspaceRoot) return;
    const dirs = new Set([workspaceRoot, ...expandedDirs]);
    await Promise.all([...dirs].map((dir) => get().refreshDir(dir)));
  },

  createFile: async (dirPath) => {
    await useTabsStore.getState().newTab(dirPath);
    await get().refreshDir(dirPath);
  },

  createFolder: async (dirPath) => {
    const existingNames = new Set(await invoke<string[]>("list_dir", { path: dirPath }));
    let candidate = "nova-pasta";
    let n = 1;
    while (existingNames.has(candidate)) {
      candidate = `nova-pasta-${n}`;
      n += 1;
    }
    await invoke("create_dir", { path: `${dirPath}/${candidate}` });
    await get().refreshDir(dirPath);
  },

  renameEntry: async (oldPath, newName, isDir) => {
    const dir = dirname(oldPath);
    const newPath = dir ? `${dir}/${newName}` : newName;
    if (newPath === oldPath) return;

    await invoke("rename_file", { from: oldPath, to: newPath });
    useTabsStore.getState().syncPathsAfterRename(oldPath, newPath);

    if (isDir) {
      set((state) => {
        const entriesByDir: Record<string, ExplorerEntry[]> = {};
        const expandedDirs = new Set<string>();
        for (const [key, value] of Object.entries(state.entriesByDir)) {
          const migratedKey =
            key === oldPath ? newPath : key.startsWith(`${oldPath}/`) ? newPath + key.slice(oldPath.length) : key;
          entriesByDir[migratedKey] = value;
        }
        for (const key of state.expandedDirs) {
          expandedDirs.add(
            key === oldPath ? newPath : key.startsWith(`${oldPath}/`) ? newPath + key.slice(oldPath.length) : key,
          );
        }
        return { entriesByDir, expandedDirs };
      });
    }

    await get().refreshDir(dir || get().workspaceRoot!);
  },

  deleteEntry: async (path, isDir) => {
    const confirmed = await ask(`Excluir "${path.split("/").pop()}"? Esta ação não pode ser desfeita.`, {
      title: "Excluir",
      kind: "warning",
    });
    if (!confirmed) return;

    const { tabs } = useTabsStore.getState();
    const affectedTabIds = tabs
      .filter((tab) => tab.path === path || tab.path.startsWith(`${path}/`))
      .map((tab) => tab.id);
    for (const tabId of affectedTabIds) {
      await useTabsStore.getState().closeTab(tabId, { skipFlush: true });
    }

    await invoke(isDir ? "delete_dir" : "delete_file", { path });

    if (isDir) {
      set((state) => {
        const entriesByDir = { ...state.entriesByDir };
        const expandedDirs = new Set(state.expandedDirs);
        for (const key of Object.keys(state.entriesByDir)) {
          if (key === path || key.startsWith(`${path}/`)) delete entriesByDir[key];
        }
        for (const key of state.expandedDirs) {
          if (key === path || key.startsWith(`${path}/`)) expandedDirs.delete(key);
        }
        return { entriesByDir, expandedDirs };
      });
    }

    await get().refreshDir(dirname(path) || get().workspaceRoot!);
  },
}));
