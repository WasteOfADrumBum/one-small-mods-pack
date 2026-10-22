// Which files a scan reads, and reading them safely: bounded in count and
// size, binary files skipped, excludes applied. Every limit that cut a scan
// short is reported, so a partial scan never reads as a full one.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const DEFAULT_EXCLUDES = ['node_modules/**', '.git/**', 'coverage/**', '.modspack/reports/**', '**/*.min.js', '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/bun.lock']
/** Build output: excluded from source scans, scanned on purpose by the exposure checks. */
export const BUILD_DIRS = ['dist', 'build', 'out', '.next', '.output', '.vercel/output', '.svelte-kit', 'public']

export const MAX_FILE_BYTES = 1_000_000
export const MAX_FILES = 20_000

/** A simple glob (`*`, `**`, `?`) as a regular expression over a relative path. */
export function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*\/?/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^(?:.*/)?${pattern}$`)
}

export const matchesAny = (rel: string, globs: readonly string[]) => globs.some(g => globToRegExp(g).test(rel))

export function isGitRepo(dir: string): boolean {
  try {
    return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).toString().trim() === 'true'
  } catch {
    return false
  }
}

export type FileList = { files: string[]; truncated: boolean; source: 'git' | 'walk' }

function walk(dir: string, base: string, out: string[], excludes: readonly string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= MAX_FILES) return
    const rel = path.relative(base, path.join(dir, entry.name)).replace(/\\/g, '/')
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (matchesAny(`${rel}/x`, excludes)) continue
      walk(path.join(dir, entry.name), base, out, excludes)
    } else if (entry.isFile() && !matchesAny(rel, excludes)) {
      out.push(rel)
    }
  }
}

/** Source files: tracked and untracked-but-not-ignored in git, else a directory walk. Build output is left out. */
export function sourceFiles(dir: string, exclude: readonly string[] = []): FileList {
  const excludes = [...DEFAULT_EXCLUDES, ...BUILD_DIRS.filter(d => d !== 'public').map(d => `${d}/**`), ...exclude]
  if (isGitRepo(dir)) {
    const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: dir, maxBuffer: 256 * 1024 * 1024, timeout: 60_000 })
      .toString()
      .split('\0')
      .filter(f => f !== '' && !matchesAny(f, excludes) && existsSync(path.join(dir, f)))
    return { files: listed.slice(0, MAX_FILES), truncated: listed.length > MAX_FILES, source: 'git' }
  }
  const out: string[] = []
  walk(dir, dir, out, excludes)
  return { files: out, truncated: out.length >= MAX_FILES, source: 'walk' }
}

/** Files in build output folders that exist (dist, build, out, .next, public ...). */
export function buildFiles(dir: string, exclude: readonly string[] = []): FileList {
  const out: string[] = []
  for (const buildDir of BUILD_DIRS) {
    const full = path.join(dir, buildDir)
    if (!existsSync(full) || !statSync(full).isDirectory()) continue
    walk(full, dir, out, [...exclude, '.next/cache/**', 'node_modules/**'])
  }
  return { files: out, truncated: out.length >= MAX_FILES, source: 'walk' }
}

export type ReadResult = { text: string } | { skipped: 'binary' | 'too-large' | 'unreadable' }

export function readText(file: string): ReadResult {
  try {
    const stat = statSync(file)
    if (stat.size > MAX_FILE_BYTES) return { skipped: 'too-large' }
    const buffer = readFileSync(file)
    if (buffer.subarray(0, 8000).includes(0)) return { skipped: 'binary' }
    return { text: buffer.toString('utf8') }
  } catch {
    return { skipped: 'unreadable' }
  }
}

export const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length
