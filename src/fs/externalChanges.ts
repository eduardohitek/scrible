import { invoke } from "@tauri-apps/api/core";
import { isAutosavePaused, useDocumentStore, type DocumentEntry } from "../store/documentStore";
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

export interface ExternalRemovalPayload {
  path: string;
}

/** O arquivo de uma ou mais abas sumiu do disco (#141). */
export function handleExternalFileRemoved(payload: ExternalRemovalPayload): void {
  const { handleExternalRemoval } = useDocumentStore.getState();
  for (const tab of useTabsStore.getState().tabs) {
    if (tab.path === payload.path) handleExternalRemoval(tab.id);
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

/** Resultado de `check_files` (`fs_ops::FileCheckResult`). */
export type FileCheckResult =
  | { kind: "Unchanged" }
  | { kind: "Changed"; mtime: number; content: string }
  | { kind: "Missing" };

/** Mtime que a aba considera "já visto". Em conflito, a versão do disco já
 * exposta no banner conta como vista, senão todo foco a entregaria de novo. */
function knownMtime(doc: DocumentEntry): number | null {
  return doc.status === "conflict" && doc.conflict ? doc.conflict.currentMtime : doc.lastSavedMtime;
}

/** Aba que pode ser checada agora: tem documento carregado no path da aba,
 * não está gravando e não está no meio de um Salvar Como. */
function checkable(tabId: string, path: string, doc: DocumentEntry | undefined): doc is DocumentEntry {
  return !!doc && doc.path === path && doc.status !== "saving" && !isAutosavePaused(tabId);
}

let focusCheckInFlight = false;

/** Rede de segurança para eventos que o watcher perde (#143): quando a janela
 * ganha foco, compara o mtime em disco de cada aba aberta com o conhecido.
 * Mtime diferente vai para `handleExternalChange` e arquivo ausente vai para
 * `handleExternalRemoval`, os mesmos caminhos do watcher. Se o watcher já
 * entregou o evento, o mtime já bate e nada acontece. Uma checagem por vez:
 * um foco com outra em voo é ignorado. */
export async function checkOpenTabsOnFocus(): Promise<void> {
  if (focusCheckInFlight) return;
  focusCheckInFlight = true;
  try {
    const { documents } = useDocumentStore.getState();
    const targets = useTabsStore.getState().tabs.flatMap((tab) => {
      const doc = documents[tab.id];
      if (!checkable(tab.id, tab.path, doc)) return [];
      return [{ tabId: tab.id, path: tab.path, knownMtime: knownMtime(doc), status: doc.status }];
    });
    if (targets.length === 0) return;

    const results = await invoke<FileCheckResult[]>("check_files", {
      files: targets.map(({ path, knownMtime }) => ({ path, knownMtime })),
    });

    const store = useDocumentStore.getState();
    targets.forEach((target, index) => {
      const result = results[index];
      const doc = useDocumentStore.getState().documents[target.tabId];
      // A aba mudou durante a checagem (save terminou, rename, conflito novo
      // pelo watcher): o resultado está velho e é descartado.
      if (!result || !checkable(target.tabId, target.path, doc) || knownMtime(doc) !== target.knownMtime) return;
      if (result.kind === "Changed") {
        store.handleExternalChange(target.tabId, result.content, result.mtime);
      } else if (result.kind === "Missing" && doc.status !== "missing") {
        store.handleExternalRemoval(target.tabId);
      }
    });
  } catch (err) {
    console.error("falha ao checar as abas no foco:", err);
  } finally {
    focusCheckInFlight = false;
  }
}
