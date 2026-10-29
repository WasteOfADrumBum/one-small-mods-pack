// Where the package's own files are. The CLI is bundled to dist/modspack.mjs,
// so the package root is one level up from the running file.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function findRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 4; i += 1) {
    if (existsSync(path.join(dir, 'mods', 'modspack-agents'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('modspack: cannot find the package root (mods/modspack-agents is missing from the install)')
}

export const PACKAGE_ROOT = findRoot()
export const DEFINITIONS_ROOT = path.join(PACKAGE_ROOT, 'mods', 'modspack-agents')
export const MODS_ROOT = path.join(PACKAGE_ROOT, 'mods')
