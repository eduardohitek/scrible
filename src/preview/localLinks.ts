import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { useTabsStore } from '../store/tabsStore'
import { resolveWorkspaceLink } from '../fs/linkPaths'

/** Called after sanitization, only for real Markdown image/link elements. */
export function prepareLocalLinks(
  container: HTMLElement,
  documentPath: string,
  root: string,
): () => void {
  container.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
    const path = resolveWorkspaceLink(image.getAttribute('src')!, documentPath, root)
    if (path) image.src = convertFileSrc(path)
  })

  function onClick(event: MouseEvent) {
    const target = event.target
    const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
    if (!link || !container.contains(link)) return
    const path = resolveWorkspaceLink(link.getAttribute('href')!, documentPath, root)
    if (!path) return
    event.preventDefault()
    // openTab creates missing files, so a broken link is checked first.
    const action = /\.md$/i.test(path)
      ? invoke('check_workspace_file', { path }).then(() => useTabsStore.getState().openTab(path))
      : invoke('open_workspace_file', { path })
    void action.catch((error: unknown) => console.error('falha ao abrir link local:', error))
  }
  container.addEventListener('click', onClick)
  return () => container.removeEventListener('click', onClick)
}
