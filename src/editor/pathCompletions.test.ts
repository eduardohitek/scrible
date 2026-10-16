import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompletionContext, currentCompletions, completionStatus } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { createPathCompletionSource } from './pathCompletions'
import { createEditorCompletion } from './slashMenu'

vi.mock('../workspace/fileIndex', () => ({
  getIndexedFiles: vi.fn(async () => ({
    root: '/workspace',
    files: [
      'z.md',
      'notes/a.md',
      'report.pdf',
      'img/photo.PNG',
      'img/foto (1).png',
      'img/icon.svg',
      'img/no.bmp',
    ],
  })),
}))

let path = '/workspace/notes/current.md'
const source = createPathCompletionSource(() => path)
async function complete(doc: string, pos = doc.length) {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  return source(new CompletionContext(state, pos, false))
}

beforeEach(() => {
  path = '/workspace/notes/current.md'
})
afterEach(() => {
  document.body.innerHTML = ''
})

describe('path completions', () => {
  it('suggests all files with Markdown first and paths relative to the document', async () => {
    const result = await complete('[link](')
    expect(result?.from).toBe(7)
    expect(result?.options.slice(0, 2).map((o) => o.label)).toEqual(['../z.md', 'a.md'])
    expect(result?.options.map((o) => o.label)).toContain('../report.pdf')
  })

  it('restricts images to supported extensions, case insensitive', async () => {
    const result = await complete('![img](')
    expect(result?.options.map((o) => o.label)).toEqual([
      '../img/foto (1).png',
      '../img/icon.svg',
      '../img/photo.PNG',
    ])
  })

  it('filters by folder/name and encodes spaces and parentheses in inserted Markdown', async () => {
    const result = await complete('![img](../img/foto')
    expect(result?.options).toHaveLength(1)
    expect(result?.options[0].apply).toBe('../img/foto%20%281%29.png')
    expect((await complete('![img](../img/foto%20'))?.options).toHaveLength(1)
  })

  it('replaces an existing destination without consuming its delimiters or title', async () => {
    const doc = '[link](a.md "title")'
    const result = await complete(doc, 8)
    expect(result?.from).toBe(7)
    expect(result?.to).toBe(11)
    const angle = await complete('![img](<../im')
    expect(angle?.from).toBe(8)
  })

  it('accepts a leading ./ in the typed path', async () => {
    const result = await complete('[link](./a')
    expect(result?.options.map((o) => o.label)).toEqual(['a.md'])
  })

  it('reads the path again after a rename or tab change', async () => {
    path = '/workspace/current.md'
    expect((await complete('[link]('))?.options.map((o) => o.label)).toContain('notes/a.md')
    path = '/outside/current.md'
    expect(await complete('[link](')).toBeNull()
  })

  it.each([
    '```md\n[link](',
    '    [link](',
    '`[link]()`',
    '\\[link](',
    '\\![img](',
    '[link](https:',
    '[link](#',
    '[link](/absolute',
    '[link](bad%',
    'texto](',
  ])('does not trigger for %s', async (doc) => {
    const pos = doc === '`[link]()`' ? 8 : doc.length
    expect(await complete(doc, pos)).toBeNull()
  })

  it('opens on typing and accepts a relative path using arrow keys and Enter', async () => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        extensions: [markdown({ base: markdownLanguage }), createEditorCompletion(() => path)],
      }),
    })
    try {
      view.focus()
      view.dispatch({
        changes: { from: 0, insert: '[link](' },
        selection: { anchor: 7 },
        userEvent: 'input.type',
      })
      await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'))
      expect(currentCompletions(view.state)[0].label).toBe('../z.md')
      // Let CodeMirror's short interaction delay elapse before accepting via keyboard.
      await new Promise((resolve) => setTimeout(resolve, 100))
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      expect(view.state.doc.toString()).toBe('[link](a.md')
    } finally {
      view.destroy()
    }
  })
})
