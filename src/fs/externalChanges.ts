import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "../store/documentStore";
import { useTabsStore } from "../store/tabsStore";

/** Payload de `external-file-changed` (`watcher.rs`). `path` é o mesmo texto
 * enviado em `set_watched_paths`, então o roteamento é por igualdade exata. */
export interface ExternalChangePayload {
  path: string;
  mtime: number;
  content: string;
}

/** Entrega uma alteração externa a toda aba aberta com aquele path (#140). */
export function handleExternalFileChanged(payload: ExternalChangePayload): void {
  const { handleExternalChange } = useDocumentStore.getState();
  for (const tab of useTabsStore.getState().tabs) {
    if (tab.path === payload.path) handleExternalChange(tab.id, payload.content, payload.mtime);
  }
}

function watchedKey(paths: string[]): string {
  return JSON.stringify([...new Set(paths)].sort());
}

/** Mantém o conjunto observado pelo watcher igual aos paths das abas abertas:
 * envia a lista completa agora e a cada mudança (abrir, fechar, renomear,
 * Salvar/Salvar Como, restauração da sessão). Mudanças que não alteram o
 * conjunto não geram chamada. Devolve a função que para a sincronização. */
export function startWatchedPathsSync(): () => void {
  let lastKey: string | null = null;
  const sync = () => {
    const key = watchedKey(useTabsStore.getState().tabs.map((tab) => tab.path));
    if (key === lastKey) return;
    lastKey = key;
    invoke("set_watched_paths", { paths: JSON.parse(key) as string[] }).catch((err: unknown) => {
      // Na próxima mudança o conjunto inteiro é reenviado.
      lastKey = null;
      console.error("falha ao atualizar os arquivos observados:", err);
    });
  };
  sync();
  return useTabsStore.subscribe(sync);
}
