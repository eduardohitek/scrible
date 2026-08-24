import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_ZOOM, snapZoom } from "../zoom/zoomLevels";

export type ThemePreference = "system" | "light" | "dark";

export interface AppSettings {
  theme: ThemePreference;
  layout: {
    splitRatio: number;
    previewVisible: boolean;
  };
  explorer: {
    visible: boolean;
    width: number;
  };
  zoom: number;
}

interface WorkspacePaths {
  root: string;
  hidden: string;
}

interface FsErrorNotFound {
  kind: "NotFound";
  path: string;
}
type FsError = FsErrorNotFound | { kind: "PermissionDenied" | "Io" | "ExternalChange" };

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  layout: { splitRatio: 0.5, previewVisible: true },
  explorer: { visible: true, width: 240 },
  zoom: DEFAULT_ZOOM,
};

// Módulo de infraestrutura (não uma store zustand) usado por themeStore.ts e
// layoutStore.ts como única porta de entrada para settings.json. Existe para
// resolver o read-merge-write que o overwrite completo anterior (themeStore
// serializando só `{ theme }`) não fazia — ver DECISIONS.md #19. `loadPromise`
// memoiza a leitura inicial: duas stores chamando init() quase juntas (ex. no
// boot do app) reaproveitam a mesma promise em vez de cada uma decidir
// "arquivo não existe" e criar settings.json só com seu próprio campo.
// `writeQueue` serializa as escritas: mesmo que dois patches disparem quase
// juntos (trocar tema enquanto solta o mouse de um resize), a última escrita
// sempre reflete o cache mais recente com ambos os patches já aplicados.
let settingsPath: string | null = null;
let cache: AppSettings | null = null;
let loadPromise: Promise<AppSettings> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function isValidTheme(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function normalize(parsed: Partial<AppSettings> | null | undefined): AppSettings {
  const theme = isValidTheme(parsed?.theme) ? parsed.theme : DEFAULT_SETTINGS.theme;
  const splitRatio =
    typeof parsed?.layout?.splitRatio === "number"
      ? parsed.layout.splitRatio
      : DEFAULT_SETTINGS.layout.splitRatio;
  const previewVisible =
    typeof parsed?.layout?.previewVisible === "boolean"
      ? parsed.layout.previewVisible
      : DEFAULT_SETTINGS.layout.previewVisible;
  const explorerVisible =
    typeof parsed?.explorer?.visible === "boolean" ? parsed.explorer.visible : DEFAULT_SETTINGS.explorer.visible;
  const explorerWidth =
    typeof parsed?.explorer?.width === "number" ? parsed.explorer.width : DEFAULT_SETTINGS.explorer.width;
  const zoom = snapZoom(parsed?.zoom);
  return {
    theme,
    layout: { splitRatio, previewVisible },
    explorer: { visible: explorerVisible, width: explorerWidth },
    zoom,
  };
}

async function writeSettings(settings: AppSettings): Promise<void> {
  await invoke("save_file", {
    path: settingsPath,
    content: JSON.stringify(settings),
    expectedMtime: null,
  });
}

async function doLoad(): Promise<AppSettings> {
  const { hidden } = await invoke<WorkspacePaths>("workspace_status");
  settingsPath = `${hidden}/settings.json`;

  try {
    const raw = await invoke<string>("read_file", { path: settingsPath });
    cache = normalize(JSON.parse(raw) as Partial<AppSettings>);
  } catch (err) {
    const fsError = err as FsError;
    cache = {
      theme: DEFAULT_SETTINGS.theme,
      layout: { ...DEFAULT_SETTINGS.layout },
      explorer: { ...DEFAULT_SETTINGS.explorer },
      zoom: DEFAULT_SETTINGS.zoom,
    };
    if (fsError.kind === "NotFound") {
      await writeSettings(cache);
    } else {
      console.error("falha ao ler settings.json:", fsError);
    }
  }

  return cache;
}

export function loadAppSettings(): Promise<AppSettings> {
  if (!loadPromise) loadPromise = doLoad();
  return loadPromise;
}

export async function patchAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  await loadAppSettings();
  cache = {
    ...cache!,
    ...patch,
    layout: { ...cache!.layout, ...patch.layout },
    explorer: { ...cache!.explorer, ...patch.explorer },
  };
  const snapshot = cache;
  writeQueue = writeQueue.then(() => writeSettings(snapshot));
  await writeQueue;
  return snapshot;
}
