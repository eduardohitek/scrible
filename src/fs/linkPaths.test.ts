import { describe, expect, it } from 'vitest'
import { relativeFilePath, resolveWorkspaceLink, encodeMarkdownPath } from './linkPaths'

describe('local Markdown paths', () => {
  it.each([
    ['/w/a.md', '/w/img/p.png', 'img/p.png'],
    ['/w/notes/a.md', '/w/img/p.png', '../img/p.png'],
    ['/w/deep/nested/a.md', '/w/b.md', '../../b.md'],
    ['C:/Users/me/scrible/a.md', 'C:/Users/me/scrible/img/p.png', 'img/p.png'],
  ])('makes %s → %s relative', (from, to, expected) => {
    expect(relativeFilePath(from, to)).toBe(expected)
  })

  it('round-trips special names through a relative Markdown URL', () => {
    const path = '../img/foto (#1) %.png'
    expect(resolveWorkspaceLink(encodeMarkdownPath(path), '/w/notes/a.md', '/w')).toBe(
      '/w/img/foto (#1) %.png',
    )
    expect(resolveWorkspaceLink('../b.md#heading', '/w/notes/a.md', '/w')).toBe('/w/b.md')
  })

  it.each([
    'https://example.com',
    'data:image/png;base64,AA',
    'file:///secret',
    '//host/image.png',
    '/etc/passwd',
    '#heading',
    '../../secret',
    '../%2e%2e/secret',
    '%00.png',
    '%zz',
    '..%5csecret',
  ])('does not resolve %s as a local file', (url) => {
    expect(resolveWorkspaceLink(url, '/w/a.md', '/w')).toBeNull()
  })
})
