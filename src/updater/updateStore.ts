import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { loadAppSettings, patchAppSettings } from "../settings/appSettings";
import { useDocumentStore } from "../store/documentStore";

/** `hidden`: nada a mostrar. `upToDate`/`error` só aparecem numa checagem
 * pedida pelo menu — a da abertura é silenciosa quando não há versão nova
 * ou a rede falha. */
export type UpdateStatus = "hidden" | "checking" | "available" | "downloading" | "upToDate" | "error";

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  /** Bytes baixados / total (o total pode não vir no `Started`). */
  downloaded: number;
  total: number | null;
  error: string | null;
  checkOnStartup: () => Promise<void>;
  checkManually: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
  skip: () => Promise<void>;
}

// `Update` segura um resource no lado Rust — fica fora do estado zustand (não
// é serializável) e é fechado sempre que o aviso some sem instalar.
let pending: Update | null = null;

function releasePending(): void {
  const update = pending;
  pending = null;
  void update?.close().catch(() => {});
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "hidden",
  version: null,
  downloaded: 0,
  total: null,
  error: null,

  checkOnStartup: async () => {
    try {
      const update = await check();
      if (!update) return;
      const { skippedVersion } = await loadAppSettings();
      // Checagem manual em curso ou já resolvida enquanto esta rodava: ela vence.
      if (update.version === skippedVersion || get().status !== "hidden") {
        void update.close().catch(() => {});
        return;
      }
      releasePending();
      pending = update;
      set({ status: "available", version: update.version, error: null });
    } catch (err) {
      console.error("falha ao checar atualização:", err);
    }
  },

  checkManually: async () => {
    const { status } = get();
    if (status === "checking" || status === "downloading") return;
    releasePending();
    set({ status: "checking", version: null, error: null });
    try {
      const update = await check();
      if (!update) {
        set({ status: "upToDate" });
        return;
      }
      pending = update;
      set({ status: "available", version: update.version });
    } catch (err) {
      set({ status: "error", error: errorMessage(err) });
    }
  },

  install: async () => {
    const update = pending;
    if (!update || get().status !== "available") return;
    set({ status: "downloading", downloaded: 0, total: null, error: null });
    try {
      // Mesmo flush do Cmd+Q (DECISIONS.md #7/#24): nenhuma edição dentro do
      // debounce de 800ms se perde quando o app reiniciar.
      await useDocumentStore.getState().flushAll();
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") set({ total: event.data.contentLength ?? null });
        else if (event.event === "Progress") set({ downloaded: get().downloaded + event.data.chunkLength });
      });
      await relaunch();
    } catch (err) {
      set({ status: "error", error: errorMessage(err) });
    }
  },

  dismiss: () => {
    if (get().status === "downloading") return;
    releasePending();
    set({ status: "hidden", version: null, error: null });
  },

  skip: async () => {
    const { version } = get();
    get().dismiss();
    if (!version) return;
    try {
      await patchAppSettings({ skippedVersion: version });
    } catch (err) {
      console.error("falha ao persistir versão pulada:", err);
    }
  },
}));
