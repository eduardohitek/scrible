import { invoke } from '@tauri-apps/api/core'

let workspaceRoot: string | null = null
let files: readonly string[] = []
let pending: Promise<void> | null = null
let refreshAgain = false

/** The existing debounced workspace-tree-changed event invalidates this cache.
 * At most one scan runs at a time; events during a scan request one follow-up. */
export function refreshFileIndex(): Promise<void> {
  if (!workspaceRoot) return Promise.resolve()
  if (pending) {
    refreshAgain = true
    return pending
  }
  pending = (async () => {
    do {
      refreshAgain = false
      try {
        files = await invoke<string[]>('list_workspace_files')
      } catch (error) {
        console.error('falha ao indexar arquivos do workspace:', error)
      }
    } while (refreshAgain)
  })().finally(() => {
    pending = null
  })
  return pending
}

export function initFileIndex(root: string): Promise<void> {
  workspaceRoot = root
  files = []
  return refreshFileIndex()
}

export async function getIndexedFiles(): Promise<{
  root: string | null
  files: readonly string[]
}> {
  // Only the initial load waits. Subsequent scans leave the previous snapshot available.
  if (files.length === 0 && pending) await pending
  return { root: workspaceRoot, files }
}
