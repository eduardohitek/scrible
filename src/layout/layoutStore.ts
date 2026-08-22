import { create } from "zustand";
import { loadAppSettings, patchAppSettings } from "../settings/appSettings";

interface LayoutState {
  splitRatio: number;
  previewVisible: boolean;
  init: () => Promise<void>;
  setSplitRatio: (ratio: number) => Promise<void>;
  togglePreview: () => Promise<void>;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  // Defaults estáticos, mesmo comportamento visual do split fixo 50/50 que
  // existia antes desta issue — quem já usa o app não vê mudança até
  // arrastar o divisor pela primeira vez.
  splitRatio: 0.5,
  previewVisible: true,

  init: async () => {
    const settings = await loadAppSettings();
    set({ splitRatio: settings.layout.splitRatio, previewVisible: settings.layout.previewVisible });
  },

  setSplitRatio: async (ratio) => {
    set({ splitRatio: ratio });
    try {
      await patchAppSettings({ layout: { splitRatio: ratio, previewVisible: get().previewVisible } });
    } catch (err) {
      console.error("falha ao persistir largura do split:", err);
    }
  },

  togglePreview: async () => {
    const previewVisible = !get().previewVisible;
    set({ previewVisible });
    try {
      await patchAppSettings({ layout: { splitRatio: get().splitRatio, previewVisible } });
    } catch (err) {
      console.error("falha ao persistir visibilidade do preview:", err);
    }
  },
}));
