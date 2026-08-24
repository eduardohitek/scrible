import { create } from "zustand";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { loadAppSettings, patchAppSettings } from "../settings/appSettings";
import { DEFAULT_ZOOM, nextZoom, prevZoom } from "./zoomLevels";

interface ZoomState {
  zoom: number;
  init: () => Promise<void>;
  zoomIn: () => Promise<void>;
  zoomOut: () => Promise<void>;
  resetZoom: () => Promise<void>;
}

function applyZoom(zoom: number): void {
  void getCurrentWebview().setZoom(zoom);
}

// Padrão idêntico a layoutStore.ts (#19): `set` local imediato pra UI
// responder na hora, persistência via patchAppSettings com try/catch —
// falha ao gravar não deve travar o zoom em si.
async function commitZoom(set: (partial: Partial<ZoomState>) => void, zoom: number): Promise<void> {
  set({ zoom });
  applyZoom(zoom);
  try {
    await patchAppSettings({ zoom });
  } catch (err) {
    console.error("falha ao persistir zoom:", err);
  }
}

export const useZoomStore = create<ZoomState>((set, get) => ({
  zoom: DEFAULT_ZOOM,

  init: async () => {
    const settings = await loadAppSettings();
    set({ zoom: settings.zoom });
    applyZoom(settings.zoom);
  },

  zoomIn: async () => {
    const zoom = nextZoom(get().zoom);
    if (zoom === get().zoom) return;
    await commitZoom(set, zoom);
  },

  zoomOut: async () => {
    const zoom = prevZoom(get().zoom);
    if (zoom === get().zoom) return;
    await commitZoom(set, zoom);
  },

  resetZoom: async () => {
    if (get().zoom === DEFAULT_ZOOM) return;
    await commitZoom(set, DEFAULT_ZOOM);
  },
}));
