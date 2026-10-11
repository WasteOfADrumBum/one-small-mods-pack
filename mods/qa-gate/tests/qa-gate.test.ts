import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { failureMessage, planScripts, scriptArgv, tail } from '../hooks/scripts'

describe('planScripts', () => {
  test('picks the first script defined for each check and skips the rest', () => {
    const scripts = { lint: 'eslint .', 'type-check': 'tsc --noEmit', test: 'vitest run', build: 'vite build' }
    expect(planScripts(scripts, {})).toEqual([
      { check: 'lint', script: 'lint' },
      { check: 'typecheck', script: 'type-check' },
      { check: 'test', script: 'test' },
    ])
  })

  test("skips npm init's placeholder test", () => {
    expect(planScripts({ test: 'echo "Error: no test specified" && exit 1' }, {})).toEqual([])
  })

  test('takes custom script names and a subset of checks', () => {
    expect(planScripts({ 'ci:spell': 'cspell .', lint: 'eslint .' }, { spellcheck: ['ci:spell'] }, ['spellcheck'])).toEqual([
      { check: 'spellcheck', script: 'ci:spell' },
    ])
  })
})

describe('output', () => {
  test('runs each package manager its own way', () => {
    expect(scriptArgv('npm', 'lint')).toEqual(['npm', 'run', '--silent', 'lint'])
    expect(scriptArgv('pnpm', 'lint')).toEqual(['pnpm', 'run', 'lint'])
  })

  test('keeps the tail of a long log without colors', () => {
    const log = Array.from({ length: 100 }, (_, i) => `\x1b[31mline ${i}\x1b[0m`).join('\n')
    const out = tail(log, 3)
    expect(out).toBe('…(97 earlier lines cut)\nline 97\nline 98\nline 99')
  })

  test('names each failed check and its command', () => {
    const message = failureMessage([{ check: 'lint', script: 'lint', exitCode: 1, output: 'a.ts:1 no-unused-vars' }], s => `npm run ${s}`)
    expect(message).toContain('qa-gate: 1 check failed after your code changes.')
    expect(message).toContain('### lint (`npm run lint` exited 1)')
    expect(message).toContain('a.ts:1 no-unused-vars')
  })
})

const PACKAGE = JSON.stringify({ scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'vitest run' } })

/** Stubs files, the scripts' exit codes by name, and display; returns what ran. */
function stubEngine(on: On, files: Record<string, string>, exitCodes: Record<string, number> = {}) {
  const runs: { argv: string[]; cwd?: string; env?: Record<string, string> }[] = []
  const toasts: string[] = []
  const find = (path: string) => Object.entries(files).find(([end]) => path.endsWith(end))?.[1]
  on('fs.exists', ($, e) => ({ value: find(e.path) !== undefined }))
  on('fs.read', ($, e) => ({ value: find(e.path) ?? '' }))
  on('process.run', ($, e) => {
    runs.push({ argv: [...e.argv], cwd: e.init?.cwd, env: e.init?.env })
    const script = e.argv.at(-1) ?? ''
    const exitCode = exitCodes[script] ?? 0
    return {
      value: { exitCode, stdout: exitCode === 0 ? 'ok' : `${script} error at src/a.ts:3`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: 'done' }))
  on('classic.Stop', () => ({}))
  return { runs, toasts }
}

test('lets a turn with no code changes end without running anything', async ($, on) => {
  const { runs } = stubEngine(on, { 'package.json': PACKAGE })

  const out = await $.classic.Stop({ stop_hook_active: false })

  expect(out.block).toBeUndefined()
  expect(runs).toEqual([])
})

test('runs every script after a code edit and lets the turn end when they pass', async ($, on) => {
  const { runs } = stubEngine(on, { 'package.json': PACKAGE, 'pnpm-lock.yaml': '' })

  await $.tool.call({ tool: 'Edit', file_path: '/work/src/a.ts', old_string: 'a', new_string: 'b' })
  const out = await $.classic.Stop({ stop_hook_active: false })

  expect(out.block).toBeUndefined()
  expect(runs.map(r => r.argv.join(' '))).toEqual(['pnpm run lint', 'pnpm run typecheck', 'pnpm run test'])
  expect(runs[0]?.env?.CI).toBe('true')
})

test('keeps Claude working with the errors of each failing script', async ($, on) => {
  stubEngine(on, { 'package.json': PACKAGE }, { typecheck: 2 })

  await $.tool.call({ tool: 'Write', file_path: '/work/src/a.ts', content: 'export const a: number = "x"' })
  const out = await $.classic.Stop({ stop_hook_active: false })

  expect(out.block).toContain('qa-gate: 1 check failed')
  expect(out.block).toContain('### typecheck (`npm run --silent typecheck` exited 2)')
  expect(out.block).toContain('typecheck error at src/a.ts:3')
})

test('passes once the fix lands, then stays quiet until code changes again', async ($, on) => {
  const exitCodes: Record<string, number> = { lint: 1 }
  const { runs } = stubEngine(on, { 'package.json': PACKAGE }, exitCodes)

  await $.tool.call({ tool: 'Write', file_path: '/work/src/a.ts', content: '' })
  expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeDefined()

  exitCodes.lint = 0
  await $.tool.call({ tool: 'Edit', file_path: '/work/src/a.ts', old_string: 'a', new_string: 'b' })
  expect((await $.classic.Stop({ stop_hook_active: true })).block).toBeUndefined()

  const before = runs.length
  expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
  expect(runs.length).toBe(before)
})

test('lets the turn end after the most attempts it is allowed', { options: { maxAttempts: 1 } }, async ($, on) => {
  const { toasts } = stubEngine(on, { 'package.json': PACKAGE }, { test: 1 })

  await $.tool.call({ tool: 'Write', file_path: '/work/src/a.ts', content: '' })
  expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeDefined()
  expect((await $.classic.Stop({ stop_hook_active: true })).block).toBeUndefined()
  expect(toasts).toEqual(['qa-gate: still failing after 1 tries; letting the turn end'])
})

test('ignores edits to files that are not code', async ($, on) => {
  const { runs } = stubEngine(on, { 'package.json': PACKAGE })

  await $.tool.call({ tool: 'Write', file_path: '/work/notes.txt', content: 'hi' })
  await $.classic.Stop({ stop_hook_active: false })

  expect(runs).toEqual([])
})

test('skips cleanly when the project has no package.json or no matching scripts', async ($, on) => {
  const { runs } = stubEngine(on, {})

  await $.tool.call({ tool: 'Write', file_path: '/work/a.ts', content: '' })
  const out = await $.classic.Stop({ stop_hook_active: false })

  expect(out.block).toBeUndefined()
  expect(runs).toEqual([])
})

test('reads the package.json path and checks from the project config', async ($, on) => {
  const { runs } = stubEngine(on, {
    'qa-gate.json': JSON.stringify({ packageJson: 'web/package.json', checks: ['lint'] }),
    'web/package.json': PACKAGE,
  })

  await $.tool.call({ tool: 'Write', file_path: '/work/web/a.tsx', content: '' })
  await $.classic.Stop({ stop_hook_active: false })

  expect(runs).toEqual([{ argv: ['npm', 'run', '--silent', 'lint'], cwd: 'web/', env: { CI: 'true', FORCE_COLOR: '0' } }])
})

test('does nothing when turned off', { options: { enabled: false } }, async ($, on) => {
  const { runs } = stubEngine(on, { 'package.json': PACKAGE }, { lint: 1 })

  await $.tool.call({ tool: 'Write', file_path: '/work/a.ts', content: '' })
  const out = await $.classic.Stop({ stop_hook_active: false })

  expect(out.block).toBeUndefined()
  expect(runs).toEqual([])
})
