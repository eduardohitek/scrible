import { invoke } from "@tauri-apps/api/core";
import { getPosition, subscribePositions } from "../editor/editorStateRegistry";
import { useTabsStore, type SessionTabEntry } from "../store/tabsStore";

const SAVE_DEBOUNCE_MS = 2000;

interface SessionData {
  tabs: SessionTabEntry[];
  activeTabIndex: number;
}

/** Lê `session.json` e reabre as abas salvas (#9). Devolve `false` quando não
 * há sessão aproveitável (primeira execução, arquivo vazio/corrompido, todos
 * os arquivos sumiram, ou falha de IPC) — o chamador cai no fluxo padrão. */
export async function restoreSession(): Promise<boolean> {
  try {
    const session = await invoke<SessionData>("read_session");
    if (session.tabs.length === 0) return false;
    await useTabsStore.getState().restoreTabs(session.tabs, session.activeTabIndex);
    return useTabsStore.getState().tabs.length > 0;
  } catch (err) {
    console.error("falha ao restaurar a sessão:", err);
    return false;
  }
}

function collectSession(): SessionData {
  const { tabs, activeTabId } = useTabsStore.getState();
  return {
    tabs: tabs.map((tab) => ({ path: tab.path, ...getPosition(tab.id) })),
    activeTabIndex: Math.max(
      0,
      tabs.findIndex((tab) => tab.id === activeTabId),
    ),
  };
}

export interface SessionPersistence {
  /** Grava agora, sem esperar o debounce (blur da janela / fechamento do app). */
  flush: () => Promise<void>;
  stop: () => void;
}

/** Salva a sessão (debounce de 2s) a cada mudança de abas — abrir, fechar,
 * reordenar, renomear, trocar de ativa — ou de cursor/scroll. Só deve ser
 * chamada *depois* da restauração: salvar antes apagaria a sessão anterior. */
export function startSessionPersistence(): SessionPersistence {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWritten: string | null = null;

  const write = async () => {
    const session = collectSession();
    if (session.tabs.length === 0) return;
    const serialized = JSON.stringify(session);
    if (serialized === lastWritten) return;
    lastWritten = serialized;
    try {
      await invoke("write_session", { session });
    } catch (err) {
      lastWritten = null;
      console.error("falha ao salvar a sessão:", err);
    }
  };

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void write();
    }, SAVE_DEBOUNCE_MS);
  };

  const unsubscribeTabs = useTabsStore.subscribe(schedule);
  const unsubscribePositions = subscribePositions(schedule);
  schedule();

  return {
    flush: async () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await write();
    },
    stop: () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribeTabs();
      unsubscribePositions();
    },
  };
}
