import { create } from "zustand";
import { loadAppSettings, patchAppSettings, type ThemePreference } from "../settings/appSettings";

export type { ThemePreference };
export type ResolvedTheme = "light" | "dark";

interface ThemeState {
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

export const useThemeStore = create<ThemeState>((set) => ({
  // Default estático — sem chamar matchMedia aqui. themeStore.ts é importado
  // por PreviewPane.tsx, e jsdom (vitest) não implementa matchMedia; só init()
  // e as funções que ele aciona podem tocar nisso.
  preference: "system",
  resolved: "light",

  init: async () => {
    const settings = await loadAppSettings();
    applyPreference(settings.theme, set);
  },

  setPreference: async (preference) => {
    applyPreference(preference, set);
    try {
      await patchAppSettings({ theme: preference });
    } catch (err) {
      console.error("falha ao persistir preferência de tema:", err);
    }
  },
}));
