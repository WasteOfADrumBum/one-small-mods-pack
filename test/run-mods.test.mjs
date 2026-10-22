// The mod runner behind `npm run validate` and `npm test`: scope, argument arrays, fail-fast and exit
// codes, on every platform. The end-to-end tests put a fake `claude` on PATH (a .cmd shim on Windows, so
// the shim path is exercised there; a script elsewhere) in a directory whose name contains spaces.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { commands, main, resolveCommand, runAll, spawnPlan, targets } from '../scripts/run-mods.mjs'
import { ROOT } from './helpers.mjs'

const tree = (names, withTests = []) => {
  const root = mkdtempSync(path.join(tmpdir(), 'run mods '))
  for (const name of names) mkdirSync(path.join(root, 'mods', name), { recursive: true })
  for (const name of withTests) mkdirSync(path.join(root, 'mods', name, 'tests'), { recursive: true })
  writeFileSync(path.join(root, 'mods', 'README.md'), 'not a mod')
  return root
}

test('run-mods: validate covers the root plugin and every mod directory, in order; files are not mods', () => {
  const root = tree(['b-mod', 'a mod'])
  try {
    assert.deepEqual(targets('validate', root), ['.', 'mods/a mod', 'mods/b-mod'])
    assert.deepEqual(commands('validate', root).map(c => c.args), [
      ['plugin', 'validate', '.'], ['plugin', 'validate', 'mods/a mod'], ['plugin', 'validate', 'mods/b-mod'],
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('run-mods: test covers only the mods that have a tests/ folder', () => {
  const root = tree(['a', 'b', 'c d'], ['c d', 'a'])
  try {
    assert.deepEqual(commands('test', root).map(c => c.args), [['plugin', 'test', 'mods/a'], ['plugin', 'test', 'mods/c d']])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('run-mods: the real repository is in scope: root plus all its mods', () => {
  const list = targets('validate', ROOT)
  assert.equal(list[0], '.')
  for (const mod of ['design-guardrail', 'privacy-guard', 'qa-gate', 'secret-scrubber', 'wcag-enforcer', 'modspack-agents']) assert.ok(list.includes(`mods/${mod}`), mod)
  assert.ok(!targets('test', ROOT).includes('mods/modspack-agents') || existsSync(path.join(ROOT, 'mods/modspack-agents/tests')))
})

test('run-mods: stops at the first failure and returns that status without running the rest', () => {
  const seen = []
  const list = ['x', 'y', 'z'].map(target => ({ target, args: ['plugin', 'validate', target] }))
  const status = runAll(list, (args, target) => (seen.push(target), target === 'y' ? 7 : 0))
  assert.equal(status, 7)
  assert.deepEqual(seen, ['x', 'y'])
  assert.equal(runAll(list, () => 0), 0)
})

test('run-mods: resolves claude from PATH, with PATHEXT on Windows', () => {
  const has = new Set([path.win32.join('C:\\tools', 'claude.CMD'), path.posix.join('/usr/local/bin', 'claude')])
  const exists = p => has.has(p)
  assert.equal(resolveCommand('claude', { platform: 'win32', env: { Path: 'C:\\nope;"C:\\tools"', PATHEXT: '.EXE;.CMD' }, exists }), path.win32.join('C:\\tools', 'claude.CMD'))
  assert.equal(resolveCommand('claude', { platform: 'linux', env: { PATH: '/bin:/usr/local/bin' }, exists }), '/usr/local/bin/claude')
  assert.equal(resolveCommand('claude', { platform: 'linux', env: { PATH: '/bin' }, exists }), undefined)
})

test('run-mods: .exe and POSIX files run directly; a Windows .cmd shim goes through quoted cmd.exe and refuses metacharacters', () => {
  assert.deepEqual(spawnPlan('C:\\bin\\claude.exe', ['plugin', 'validate', 'mods/a mod'], 'win32'), { file: 'C:\\bin\\claude.exe', args: ['plugin', 'validate', 'mods/a mod'], shell: false })
  assert.deepEqual(spawnPlan('/usr/bin/claude', ['plugin', 'test', 'mods/a'], 'linux'), { file: '/usr/bin/claude', args: ['plugin', 'test', 'mods/a'], shell: false })
  assert.deepEqual(spawnPlan('C:\\Program Files\\c\\claude.cmd', ['plugin', 'validate', 'mods/a mod'], 'win32'), { file: '"C:\\Program Files\\c\\claude.cmd" "plugin" "validate" "mods/a mod"', args: [], shell: true })
  assert.throws(() => spawnPlan('C:\\c\\claude.cmd', ['plugin', 'validate', 'mods/a&calc'], 'win32'), /refusing/)
  assert.deepEqual(spawnPlan('/odd/claude.cmd', ['a&b'], 'linux').shell, false)
})

// ---- end to end, with a fake claude -------------------------------------------------------------------
function fakeClaude(failOn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fake claude '))
  const log = path.join(dir, 'calls.jsonl')
  writeFileSync(path.join(dir, 'fake.mjs'), [
    "import { appendFileSync } from 'node:fs'",
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n')`,
    `process.exit(process.argv.slice(2).some(a => a.endsWith(${JSON.stringify(failOn ?? '\u0000')})) ? 5 : 0)`,
  ].join('\n'))
  const node = process.execPath
  if (process.platform === 'win32') writeFileSync(path.join(dir, 'claude.cmd'), `@echo off\r\n"${node}" "%~dp0fake.mjs" %*\r\n`)
  else {
    writeFileSync(path.join(dir, 'claude'), `#!/bin/sh\nexec "${node}" "$(dirname "$0")/fake.mjs" "$@"\n`)
    chmodSync(path.join(dir, 'claude'), 0o755)
  }
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])
  return { dir, calls, env: { ...process.env, PATH: dir + path.delimiter + (process.env.PATH ?? ''), Path: undefined } }
}

const quiet = fn => {
  const err = console.error
  console.error = () => {}
  try {
    return fn()
  } finally {
    console.error = err
  }
}

test('run-mods: end to end, every directory is validated with its path intact, from the repository root', () => {
  const root = tree(['one', 'two words'])
  const fake = fakeClaude()
  try {
    assert.equal(quiet(() => main(['validate'], { root, env: fake.env })), 0)
    assert.deepEqual(fake.calls().map(c => c.args), [['plugin', 'validate', '.'], ['plugin', 'validate', 'mods/one'], ['plugin', 'validate', 'mods/two words']])
    assert.ok(fake.calls().every(c => path.resolve(c.cwd) === path.resolve(root) || c.cwd.toLowerCase() === root.toLowerCase()))
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(fake.dir, { recursive: true, force: true })
  }
})

test('run-mods: end to end, a failing validation is never hidden: exit status propagates and later mods are not run', () => {
  const root = tree(['a', 'b', 'c'])
  const fake = fakeClaude('mods/b')
  try {
    assert.equal(quiet(() => main(['validate'], { root, env: fake.env })), 5)
    assert.deepEqual(fake.calls().map(c => c.args.at(-1)), ['.', 'mods/a', 'mods/b'])
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(fake.dir, { recursive: true, force: true })
  }
})

test('run-mods: the script as npm runs it exits non-zero when a check fails, 3 when claude is missing, 2 on bad usage', () => {
  const root = tree(['a'])
  const fake = fakeClaude('mods/a')
  try {
    // The script finds its repository from its own location, so run a copy placed in the temporary one.
    mkdirSync(path.join(root, 'scripts'))
    for (const file of ['run-mods.mjs', 'root.mjs']) copyFileSync(path.join(ROOT, 'scripts', file), path.join(root, 'scripts', file))
    const run = (args, env) => spawnSync(process.execPath, [path.join(root, 'scripts', 'run-mods.mjs'), ...args], { cwd: root, env, encoding: 'utf8' })
    assert.equal(run(['validate'], fake.env).status, 5)
    const empty = path.join(root, 'empty')
    mkdirSync(empty)
    const noClaude = run(['validate'], { ...process.env, PATH: empty, Path: empty })
    assert.equal(noClaude.status, 3)
    assert.match(noClaude.stderr, /BLOCKED/)
    assert.equal(run(['frobnicate'], fake.env).status, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(fake.dir, { recursive: true, force: true })
  }
})
