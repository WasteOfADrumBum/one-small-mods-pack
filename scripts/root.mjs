// The repository root for a script or test, from its own `import.meta.url`.
// `new URL(url).pathname` is wrong on Windows: it yields "/C:/Users/me/repo/..."
// and path.resolve turns that into "C:\C:\Users\me\repo". fileURLToPath
// understands drive letters, UNC hosts and percent-encoding on every platform.
// `windows: true` evaluates the Windows rules on any OS, for the tests.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function projectRoot(metaUrl, { windows = false } = {}) {
  const p = windows ? path.win32 : path
  return p.resolve(p.dirname(fileURLToPath(metaUrl, { windows })), '..')
}
