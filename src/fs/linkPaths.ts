/** Paths in the frontend use `/`, including Windows paths normalized at the IPC boundary. */
export function isWithinWorkspace(path: string, root: string): boolean {
  return path.startsWith(`${root}/`)
}

export function relativeFilePath(documentPath: string, targetPath: string): string {
  const from = documentPath.split('/').slice(0, -1)
  const to = targetPath.split('/')
  let common = 0
  while (common < from.length && common < to.length && from[common] === to[common]) common++
  return [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/')
}

export function encodeMarkdownPath(path: string): string {
  return path
    .split('/')
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/')
}

/** Resolve only local relative destinations; remote URLs and fragment links keep their behavior. */
export function resolveWorkspaceLink(
  destination: string,
  documentPath: string,
  root: string,
): string | null {
  if (!destination || /^[a-z][a-z\d+.-]*:|^[/#?]/i.test(destination)) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(destination.split(/[?#]/)[0])
  } catch {
    return null
  }
  if (!decoded || decoded.includes('\0') || decoded.includes('\\')) return null
  const parts = documentPath.split('/').slice(0, -1)
  for (const part of decoded.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  const path = parts.join('/')
  return isWithinWorkspace(path, root) ? path : null
}
