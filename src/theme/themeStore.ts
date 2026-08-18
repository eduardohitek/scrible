import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

interface WorkspacePaths {
  root: string;
  hidden: string;
}

interface FsErrorNotFound {
  kind: "NotFound";
  path: string;
}
type FsError = FsErrorNotFound | { kind: "PermissionDenied" | "Io" | "ExternalChange" };

interface AppSettings {
  theme: ThemePreference;
}

interface ThemeState {
  settingsPath: string | null;
  preference: ThemePreference;
  resolved: ResolvedTheme;
  init: () => Promise<void>;
  setPreference: (preference: ThemePreference) => Promise<void>;
}

// Sobrevivem entre chamadas mas não fazem parte do estado serializável da
// store — mesmo padrão do `debounceTimer` em documentStore.ts.
let mediaQuery: MediaQueryList | null = null;
let mediaQueryListener: ((event: MediaQueryListEvent) => void) | null = null;

function detectSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? detectSystemTheme() : preference;
}

function teardownSystemListener() {
  if (mediaQuery && mediaQueryListener) {
    mediaQuery.removeEventListener("change", mediaQueryListener);
  }
  mediaQuery = null;
  mediaQueryListener = null;
}

// Idempotente: sempre desmonta antes de montar de novo, então StrictMode
// (useEffect roda 2x em dev) ou chamadas repetidas de setPreference("system")
// nunca deixam listeners duplicados.
function setupSystemListener(set: (partial: Partial<ThemeState>) => void) {
  teardownSystemListener();
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQueryListener = (event) => set({ resolved: event.matches ? "dark" : "light" });
  mediaQuery.addEventListener("change", mediaQueryListener);
}

function applyPreference(preference: ThemePreference, set: (partial: Partial<ThemeState>) => void) {
  set({ preference, resolved: resolveTheme(preference) });
  if (preference === "system") {
    setupSystemListener(set);
  } else {
    teardownSystemListener();
  }
}

async function persistPreference(settingsPath: string, preference: ThemePreference) {
  await invoke("save_file", {
    path: settingsPath,
    content: JSON.stringify({ theme: preference } satisfies AppSettings),
    expectedMtime: null,
  });
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  settingsPath: null,
  // Default estático — sem chamar matchMedia aqui. themeStore.ts é importado
  // por PreviewPane.tsx, e jsdom (vitest) não implementa matchMedia; só init()
  // e as funções que ele aciona podem tocar nisso.
  preference: "system",
  resolved: "light",

  init: async () => {
    const { hidden } = await invoke<WorkspacePaths>("workspace_status");
    const settingsPath = `${hidden}/settings.json`;
    let preference: ThemePreference = "system";

    try {
      const raw = await invoke<string>("read_file", { path: settingsPath });
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      if (parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system") {
        preference = parsed.theme;
      }
    } catch (err) {
      const fsError = err as FsError;
      if (fsError.kind !== "NotFound") {
        console.error("falha ao ler settings.json:", fsError);
      } else {
        await persistPreference(settingsPath, preference);
      }
    }

    set({ settingsPath });
    applyPreference(preference, set);
  },

  setPreference: async (preference) => {
    applyPreference(preference, set);
    const { settingsPath } = get();
    if (!settingsPath) return;
    try {
      await persistPreference(settingsPath, preference);
    } catch (err) {
      console.error("falha ao persistir preferência de tema:", err);
    }
  },
}));
