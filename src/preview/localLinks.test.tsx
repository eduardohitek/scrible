import { fireEvent, render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { useTabsStore } from '../store/tabsStore'
import { PreviewPane } from './PreviewPane'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost${path}`),
  invoke: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('mermaid', () => ({ default: { initialize: vi.fn() } }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('local links in the preview', () => {
  it("renders workspace images through Tauri's asset protocol", () => {
    const { container } = render(
      <PreviewPane
        source="![foto](../img/foto%20%281%29.png)"
        documentPath="/w/notes/a.md"
        workspaceRoot="/w"
      />,
    )
    expect(convertFileSrc).toHaveBeenCalledWith('/w/img/foto (1).png')
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'asset://localhost/w/img/foto (1).png',
    )
  })

  it('opens Markdown in a tab and other files in the system app', async () => {
    const open = vi.spyOn(useTabsStore.getState(), 'openTab').mockResolvedValue()
    const { container } = render(
      <PreviewPane
        source="[nota](../b.md) [pdf](../report.pdf)"
        documentPath="/w/notes/a.md"
        workspaceRoot="/w"
      />,
    )
    const links = container.querySelectorAll('a')
    fireEvent.click(links[0])
    expect(invoke).toHaveBeenCalledWith('check_workspace_file', { path: '/w/b.md' })
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith('/w/b.md'))
    fireEvent.click(links[1])
    expect(invoke).toHaveBeenCalledWith('open_workspace_file', { path: '/w/report.pdf' })
    open.mockRestore()
  })

  it('does not open (and so create) a missing Markdown file from a broken link', async () => {
    const open = vi.spyOn(useTabsStore.getState(), 'openTab').mockResolvedValue()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(invoke).mockRejectedValueOnce({ kind: 'NotFound', path: '/w/typo.md' })
    const { container } = render(
      <PreviewPane source="[typo](typo.md)" documentPath="/w/a.md" workspaceRoot="/w" />,
    )
    fireEvent.click(container.querySelector('a')!)
    await vi.waitFor(() => expect(log).toHaveBeenCalled())
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
    log.mockRestore()
  })

  it('shows the new document immediately when switching tabs, without resolving stale links', () => {
    const { container, rerender } = render(
      <PreviewPane source="[old](old.md)" documentPath="/w/old/a.md" workspaceRoot="/w" />,
    )
    rerender(<PreviewPane source="[new](new.md)" documentPath="/w/new/a.md" workspaceRoot="/w" />)
    expect(container.querySelector('a')?.textContent).toBe('new')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('new.md')
  })

  it('leaves remote images and fragment links alone and updates paths after switching tabs', () => {
    const { container, rerender } = render(
      <PreviewPane
        source="![local](img.png) ![remote](https://example.com/a.png) [section](#x)"
        documentPath="/w/a.md"
        workspaceRoot="/w"
      />,
    )
    expect(convertFileSrc).toHaveBeenLastCalledWith('/w/img.png')
    expect(container.querySelectorAll('img')[1].getAttribute('src')).toBe(
      'https://example.com/a.png',
    )
    expect(container.querySelector('a')?.getAttribute('href')).toBe('#x')
    rerender(
      <PreviewPane source="![local](img.png)" documentPath="/w/notes/b.md" workspaceRoot="/w" />,
    )
    expect(convertFileSrc).toHaveBeenLastCalledWith('/w/notes/img.png')
  })
})
