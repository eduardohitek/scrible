import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
beforeEach(() => {
  vi.resetModules()
  vi.mocked(invoke).mockReset()
})

describe('workspace file index', () => {
  it('loads once and serves hundreds of completion queries without filesystem calls', async () => {
    vi.mocked(invoke).mockResolvedValue(Array.from({ length: 600 }, (_, i) => `${i}.md`))
    const index = await import('./fileIndex')
    await index.initFileIndex('/workspace')
    for (let i = 0; i < 600; i++) expect((await index.getIndexedFiles()).files).toHaveLength(600)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous snapshot during refresh and coalesces watcher events without losing the last event', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(['old.md'])
    const index = await import('./fileIndex')
    await index.initFileIndex('/workspace')
    let finish!: (files: string[]) => void
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    vi.mocked(invoke).mockResolvedValueOnce(['renamed.md', 'new.png'])
    const refreshing = index.refreshFileIndex()
    void index.refreshFileIndex()
    void index.refreshFileIndex()
    expect((await index.getIndexedFiles()).files).toEqual(['old.md'])
    finish(['new.png'])
    await refreshing
    expect((await index.getIndexedFiles()).files).toEqual(['renamed.md', 'new.png'])
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('waits for the initial scan and preserves cached files after an IO failure', async () => {
    let finish!: (files: string[]) => void
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const index = await import('./fileIndex')
    const initial = index.initFileIndex('/workspace')
    const query = index.getIndexedFiles()
    finish(['a.md'])
    await initial
    expect((await query).files).toEqual(['a.md'])
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(invoke).mockRejectedValueOnce(new Error('IO'))
    await index.refreshFileIndex()
    expect((await index.getIndexedFiles()).files).toEqual(['a.md'])
    log.mockRestore()
  })
})
