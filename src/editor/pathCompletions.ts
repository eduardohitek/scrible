import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { getIndexedFiles } from '../workspace/fileIndex'
import { encodeMarkdownPath, isWithinWorkspace, relativeFilePath } from '../fs/linkPaths'
import { isInsideCodeBlock } from './fenceCompletions'

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|svg|webp)$/i

function destinationAt(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos)
  const before = context.state.sliceDoc(line.from, context.pos)
  const match = /(!?)\[(?:\\.|[^\]\\])*\]\((<?)([^<>\s)]*)$/.exec(before)
  if (!match || /^[a-z][a-z\d+.-]*:|^[/#?]/i.test(match[3])) return null
  const start = line.from + match.index
  // An escaped opening bracket/image marker is literal Markdown.
  const escapes = before.slice(0, match.index).match(/\\+$/)?.[0].length ?? 0
  if (escapes % 2 || isInsideCodeBlock(context, start + 1)) return null
  for (let node = syntaxTree(context.state).resolveInner(start, 1); node;) {
    if (node.name === 'InlineCode') return null
    if (!node.parent) break
    node = node.parent
  }
  return { from: context.pos - match[3].length, image: match[1] === '!', query: match[3] }
}

/** Bind to the tab, reading its current path each time so renames and tab switches are safe. */
export function createPathCompletionSource(getDocumentPath: () => string | null): CompletionSource {
  return async (context): Promise<CompletionResult | null> => {
    const destination = destinationAt(context)
    const documentPath = getDocumentPath()
    if (!destination || !documentPath) return null
    const { root, files } = await getIndexedFiles()
    if (context.aborted || !root || !isWithinWorkspace(documentPath, root)) return null
    let query: string
    try {
      query = decodeURIComponent(destination.query)
        .replace(/^(?:\.\/)+/, '')
        .toLowerCase()
    } catch {
      return null
    }
    const paths = files
      .filter((path) => !destination.image || IMAGE_EXTENSION.test(path))
      .map((path) => relativeFilePath(documentPath, `${root}/${path}`))
      .filter((path) => path.toLowerCase().includes(query))
      .sort((a, b) => Number(/\.md$/i.test(b)) - Number(/\.md$/i.test(a)) || a.localeCompare(b))
    // Replace the rest of an existing destination, preserving closing delimiters/title.
    const after = context.state.sliceDoc(context.pos, context.state.doc.lineAt(context.pos).to)
    const to = context.pos + (after.match(/^[^<>\s)]*/)?.[0].length ?? 0)
    return {
      from: destination.from,
      to,
      filter: false,
      options: paths.map((path) => ({
        label: path,
        apply: encodeMarkdownPath(path),
        type: 'file',
      })),
    }
  }
}
