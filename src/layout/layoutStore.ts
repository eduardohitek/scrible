import { create } from "zustand";
import { loadAppSettings, patchAppSettings, type ViewMode } from "../settings/appSettings";

export type { ViewMode };

/** Ordem do ciclo do ⇧⌘P: só editor → lado a lado → só visualização → volta. */
export const VIEW_MODE_CYCLE: readonly ViewMode[] = ["editor", "split", "preview"];

export const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  editor: "Editor",
  split: "Lado a lado",
  preview: "Visualização",
};

export function nextViewMode(mode: ViewMode): ViewMode {
  const index = VIEW_MODE_CYCLE.indexOf(mode);
  return VIEW_MODE_CYCLE[(index + 1) % VIEW_MODE_CYCLE.length];
}

interface LayoutState {
  splitRatio: number;
  viewMode: ViewMode;
  init: () => Promise<void>;
  setSplitRatio: (ratio: number) => Promise<void>;
  setViewMode: (mode: ViewMode) => Promise<void>;
  cycleViewMode: () => Promise<void>;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  // Defaults estáticos, mesmo comportamento visual do split fixo 50/50 que
  // existia antes desta issue — quem já usa o app não vê mudança até
  // arrastar o divisor pela primeira vez.
  splitRatio: 0.5,
  viewMode: "split",

  init: async () => {
    const settings = await loadAppSettings();
    set({ splitRatio: settings.layout.splitRatio, viewMode: settings.layout.viewMode });
  },

  setSplitRatio: async (ratio) => {
    set({ splitRatio: ratio });
    try {
      await patchAppSettings({ layout: { splitRatio: ratio, viewMode: get().viewMode } });
    } catch (err) {
      console.error("falha ao persistir largura do split:", err);
    }
  },

  setViewMode: async (viewMode) => {
    set({ viewMode });
    try {
      await patchAppSettings({ layout: { splitRatio: get().splitRatio, viewMode } });
    } catch (err) {
      console.error("falha ao persistir modo de exibição:", err);
    }
  },

  cycleViewMode: () => get().setViewMode(nextViewMode(get().viewMode)),
}));
