// Shared by the CLI tests: temporary projects and a captured CLI run.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { main } from '../dist/lib.mjs'

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

/** A temporary directory holding `files` ({ relative path: text }); removed by cleanup(). */
export function project(files = {}, { git = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'modspack-test-'))
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), text)
  }
  if (git) {
    const run = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 'test@example.com')
    run('config', 'user.name', 'Test')
    run('config', 'commit.gpgsign', 'false')
    run('add', '-A')
    run('commit', '-q', '-m', 'initial', '--allow-empty')
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Runs the CLI in-process and returns its exit code and output. */
export async function cli(args, cwd) {
  const out = []
  const err = []
  const code = await main([...args], { out: t => out.push(t), err: t => err.push(t), cwd })
  return { code, out: out.join('\n'), err: err.join('\n') }
}
