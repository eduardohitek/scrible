import { invoke } from "@tauri-apps/api/core";
import { normalizePath } from "../fs/paths";
import { DEFAULT_ZOOM, snapZoom } from "../zoom/zoomLevels";

export type ThemePreference = "system" | "light" | "dark";

/** Modo de exibição: só editor, lado a lado ou só visualização. */
export type ViewMode = "editor" | "split" | "preview";

export interface AppSettings {
  theme: ThemePreference;
  layout: {
    splitRatio: number;
    viewMode: ViewMode;
  };
  explorer: {
    visible: boolean;
    width: number;
  };
  zoom: number;
  /** Versão que o usuário mandou pular no aviso de atualização — a checagem
   * da abertura deixa de oferecê-la; a do menu oferece mesmo assim. */
  skippedVersion: string | null;
  /** Preview inline nível 3 (#29): esconde os marcadores de sintaxe fora da
   * linha do cursor. Desligado = nível 2 (marcadores sempre visíveis). */
  hideMarkers: boolean;
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
  layout: { splitRatio: 0.5, viewMode: "split" },
  explorer: { visible: true, width: 240 },
  zoom: DEFAULT_ZOOM,
  skippedVersion: null,
  hideMarkers: false,
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

function isValidViewMode(value: unknown): value is ViewMode {
  return value === "editor" || value === "split" || value === "preview";
}

/** Lê `viewMode`; sem ele, migra o booleano `previewVisible` de antes do modo
 * só visualização (`false` → só editor, `true` → lado a lado). */
function normalizeViewMode(layout: unknown): ViewMode {
  const raw = layout as { viewMode?: unknown; previewVisible?: unknown } | null | undefined;
  if (isValidViewMode(raw?.viewMode)) return raw.viewMode;
  if (typeof raw?.previewVisible === "boolean") return raw.previewVisible ? "split" : "editor";
  return DEFAULT_SETTINGS.layout.viewMode;
}

function normalize(parsed: Partial<AppSettings> | null | undefined): AppSettings {
  const theme = isValidTheme(parsed?.theme) ? parsed.theme : DEFAULT_SETTINGS.theme;
  const splitRatio =
    typeof parsed?.layout?.splitRatio === "number"
      ? parsed.layout.splitRatio
      : DEFAULT_SETTINGS.layout.splitRatio;
  const viewMode = normalizeViewMode(parsed?.layout);
  const explorerVisible =
    typeof parsed?.explorer?.visible === "boolean" ? parsed.explorer.visible : DEFAULT_SETTINGS.explorer.visible;
  const explorerWidth =
    typeof parsed?.explorer?.width === "number" ? parsed.explorer.width : DEFAULT_SETTINGS.explorer.width;
  const zoom = snapZoom(parsed?.zoom);
  const skippedVersion =
    typeof parsed?.skippedVersion === "string" ? parsed.skippedVersion : DEFAULT_SETTINGS.skippedVersion;
  const hideMarkers =
    typeof parsed?.hideMarkers === "boolean" ? parsed.hideMarkers : DEFAULT_SETTINGS.hideMarkers;
  return {
    theme,
    layout: { splitRatio, viewMode },
    explorer: { visible: explorerVisible, width: explorerWidth },
    zoom,
    skippedVersion,
    hideMarkers,
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
  settingsPath = `${normalizePath(hidden)}/settings.json`;

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
      skippedVersion: DEFAULT_SETTINGS.skippedVersion,
      hideMarkers: DEFAULT_SETTINGS.hideMarkers,
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
