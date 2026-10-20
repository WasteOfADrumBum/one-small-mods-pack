// scripts/link-types.mjs located the repository with `new URL(import.meta.url).pathname`,
// which on Windows gives "/C:/Users/..." and then "C:\C:\Users\..." (ENOENT).
// The root now comes from fileURLToPath (scripts/root.mjs). The Windows rules
// are evaluated on any OS through `windows: true`, so no Windows machine is needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { projectRoot } from '../scripts/root.mjs'
import { ROOT } from './helpers.mjs'

const windowsRulesAvailable = (() => { try { return fileURLToPath('file:///C:/a', { windows: true }) === 'C:\\a' } catch { return false } })()

test('root: Windows drive-letter, spaced, encoded and UNC locations resolve to the repository root', { skip: !windowsRulesAvailable && 'this Node version cannot evaluate the Windows rules' }, () => {
  const win = url => projectRoot(url, { windows: true })
  assert.equal(win('file:///C:/Users/me/one-small-mods-pack/scripts/link-types.mjs'), 'C:\\Users\\me\\one-small-mods-pack')
  assert.equal(win('file:///c:/Users/Jane%20Doe/My%20Repos/one-small-mods-pack/scripts/link-types.mjs'), 'c:\\Users\\Jane Doe\\My Repos\\one-small-mods-pack')
  assert.equal(win('file:///D:/work/repo/site/build.mjs'), 'D:\\work\\repo')
  assert.equal(win('file://server/share/repo/scripts/build.mjs'), '\\\\server\\share\\repo')
  // The old calculation is what produced the doubled drive.
  const old = new URL('file:///C:/Users/me/repo/scripts/link-types.mjs').pathname
  assert.equal(old, '/C:/Users/me/repo/scripts/link-types.mjs')
  assert.ok(path.win32.join('C:', old).includes('C:\\C:'), 'documents how the pathname form doubles the drive')
  for (const url of ['file:///C:/Users/me/repo/scripts/link-types.mjs', 'file:///D:/x y/repo/scripts/a.mjs']) assert.ok(!/^[a-z]:\\[a-z]:/i.test(win(url)), url)
})

test('root: with no option the rules of the running platform apply (the native-Windows failure was an explicit windows:false)', () => {
  // A real file URL for a real file on this machine: drive-lettered on Windows, rooted on POSIX.
  const here = pathToFileURL(path.join(ROOT, 'scripts', 'link-types.mjs')).href
  const native = projectRoot(here)
  assert.equal(native, projectRoot(here, { windows: process.platform === 'win32' }))
  assert.equal(native, ROOT)
  assert.ok(existsSync(path.join(native, 'package.json')) && existsSync(path.join(native, 'mods')), `${native} is not the repository root`)
  assert.ok(!/^[a-z]:[\\/]+[a-z]:/i.test(native), `doubled drive in ${native}`)
  assert.ok(existsSync(path.join(projectRoot(import.meta.url), 'scripts', 'root.mjs')))
  // The same logic as every script uses, from each script's own location.
  for (const f of ['scripts/link-types.mjs', 'scripts/build.mjs', 'scripts/check-shared.mjs', 'site/build.mjs', 'test/helpers.mjs']) {
    assert.equal(projectRoot(pathToFileURL(path.join(ROOT, f)).href), ROOT, f)
  }
})

test('root: forcing POSIX rules on a drive-letter URL is what produced C:\\C:', { skip: !windowsRulesAvailable && 'this Node version cannot evaluate the Windows rules' }, () => {
  const url = 'file:///C:/Users/me/repo/scripts/link-types.mjs'
  assert.equal(fileURLToPath(url, { windows: false }), '/C:/Users/me/repo/scripts/link-types.mjs')
  assert.equal(fileURLToPath(url, { windows: true }), 'C:\\Users\\me\\repo\\scripts\\link-types.mjs')
  assert.equal(projectRoot(url, { windows: true }), 'C:\\Users\\me\\repo')
})

test('root: POSIX locations, spaces and encoded characters resolve as before', () => {
  // Synthetic POSIX URLs name the POSIX rules, so this holds on a Windows runner too.
  assert.equal(projectRoot('file:///home/me/one-small-mods-pack/scripts/link-types.mjs', { windows: false }), '/home/me/one-small-mods-pack')
  assert.equal(projectRoot('file:///home/me/My%20Repos/a%23b/scripts/build.mjs', { windows: false }), '/home/me/My Repos/a#b')
  assert.equal(projectRoot(pathToFileURL(path.join(ROOT, 'scripts', 'link-types.mjs')).href), ROOT)
  assert.equal(projectRoot(import.meta.url), ROOT)
})

/** A copy of the script in a throwaway project, so the real types/ folder is never touched. */
function sandbox(base) {
  const dir = mkdtempSync(path.join(tmpdir(), base))
  mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  for (const f of ['link-types.mjs', 'root.mjs']) cpSync(path.join(ROOT, 'scripts', f), path.join(dir, 'scripts', f))
  mkdirSync(path.join(dir, 'mods', 'one', '.claude-plugin', 'types', 'claude-code'), { recursive: true })
  mkdirSync(path.join(dir, 'mods', 'two'), { recursive: true })
  return dir
}
const run = (dir, ...args) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'link-types.mjs'), ...args], { cwd: tmpdir(), encoding: 'utf8' })

test('link-types: finds the declarations a mod folder holds and copies them to types/claude-code.d.ts', () => {
  for (const name of ['modspack-types-', 'modspack types with space-']) {
    const dir = sandbox(name)
    try {
      writeFileSync(path.join(dir, 'mods', 'one', '.claude-plugin', 'types', 'claude-code', 'index.d.ts'), '// declarations-fixture\nexport {}\n')
      const result = run(dir)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /declarations-fixture -> types\/claude-code\.d\.ts/)
      assert.equal(readFileSync(path.join(dir, 'types', 'claude-code.d.ts'), 'utf8'), '// declarations-fixture\nexport {}\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('link-types: an explicit path argument is used; with nothing to find it exits 1 and writes no declarations', () => {
  const dir = sandbox('modspack-types-')
  try {
    const none = run(dir)
    assert.equal(none.status, 1)
    assert.match(none.stderr, /No Claude Code type declarations found/)
    assert.ok(!existsSync(path.join(dir, 'types', 'claude-code.d.ts')), 'no declarations are invented')
    const given = path.join(dir, 'given.d.ts')
    writeFileSync(given, '// from-argument\n')
    const result = run(dir, given)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(path.join(dir, 'types', 'claude-code.d.ts'), 'utf8'), '// from-argument\n')
    // The repository's own types folder was not written by these runs.
    assert.ok(execFileSync('git', ['status', '--porcelain', 'types'], { cwd: ROOT, encoding: 'utf8' }).trim() === '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
