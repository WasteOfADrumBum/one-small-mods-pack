// The repository root for a script or test, from its own `import.meta.url`.
// `new URL(url).pathname` is wrong on Windows: it yields "/C:/Users/me/repo/..."
// and path.resolve turns that into "C:\C:\Users\me\repo".
//
// fileURLToPath understands drive letters, UNC hosts and percent-encoding, but
// only when it is left to pick the rules of the running platform. Passing
// `{ windows: false }` explicitly forces POSIX parsing even on Windows and
// reproduces the same doubled drive, so `windows` is passed on only when a
// caller (the tests) asks to evaluate the Windows or POSIX rules on another OS.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function projectRoot(metaUrl, { windows } = {}) {
  const p = windows === undefined ? path : windows ? path.win32 : path.posix
  const file = windows === undefined ? fileURLToPath(metaUrl) : fileURLToPath(metaUrl, { windows })
  return p.resolve(p.dirname(file), '..')
}
