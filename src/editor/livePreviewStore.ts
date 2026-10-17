import { create } from "zustand";
import { loadAppSettings, patchAppSettings } from "../settings/appSettings";

interface LivePreviewState {
  /** `true` = nível 3 (#29): marcadores somem fora da linha do cursor.
   * `false` = nível 2 (#12), o default. */
  hideMarkers: boolean;
  init: () => Promise<void>;
  toggle: () => Promise<void>;
}

// Mesmo padrão de zoomStore/layoutStore: `set` local imediato e persistência
// via patchAppSettings — falha ao gravar não trava a preferência em si.
export const useLivePreviewStore = create<LivePreviewState>((set, get) => ({
  hideMarkers: false,

  init: async () => {
    const settings = await loadAppSettings();
    set({ hideMarkers: settings.hideMarkers });
  },

  toggle: async () => {
    const hideMarkers = !get().hideMarkers;
    set({ hideMarkers });
    try {
      await patchAppSettings({ hideMarkers });
    } catch (err) {
      console.error("falha ao persistir preferência de marcadores:", err);
    }
  },
}));
