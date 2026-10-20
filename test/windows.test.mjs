// Behaviour that differs on Windows, tested on every platform: command shims,
// CRLF checkouts and path separators. (A native Windows CI job runs the whole suite.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { DEFINITIONS_ROOT, SHELL_SAFE, loadAgents, loadSkills, npmCli, readLf, spawnTool, validatePackage } from '../dist/lib.mjs'
import { ROOT } from './helpers.mjs'

test('exec: the npm entry is found beside node (the Windows layout) or from npm_execpath, and run with node, not a shell', () => {
  const entry = path.join('/opt/nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  assert.equal(npmCli(path.join('/opt/nodejs', 'node.exe'), {}, p => p === entry), entry)
  assert.equal(npmCli('/elsewhere/node', {}, () => false), undefined)
  assert.equal(npmCli('x', { npm_execpath: '/usr/lib/node_modules/npm/bin/npm-cli.js' }, () => true), '/usr/lib/node_modules/npm/bin/npm-cli.js')
  assert.equal(npmCli('x', { npm_execpath: '/usr/lib/node_modules/pnpm/bin/pnpm.cjs' }, () => false), undefined)
})

test('exec: the Windows shell path accepts script names and refuses anything the shell would interpret', () => {
  for (const ok of ['run', '--silent', 'test:all', '@scope/pkg', 'build-prod', 'a.b_c=1']) assert.ok(SHELL_SAFE.test(ok), ok)
  for (const bad of ['a b', 'a&b', 'a|b', 'a;b', 'a>b', '$(x)', '`x`', 'a"b', "a'b", 'a%PATH%', 'a\nb', '']) assert.ok(!SHELL_SAFE.test(bad), JSON.stringify(bad))
  // pnpm is a shim on Windows: with an unsafe script name nothing is spawned and the caller gets an error.
  const result = spawnTool('pnpm', ['run', 'x & calc'], { encoding: 'utf8' }, 'win32')
  assert.equal(result.status, null)
  assert.match(result.error.message, /not running pnpm through the Windows shell/)
})

test('exec: on POSIX spawnTool is plain spawnSync', () => {
  const result = spawnTool(process.execPath, ['-e', 'process.stdout.write("hi"); process.exit(3)'], { encoding: 'utf8' }, 'linux')
  assert.equal(result.stdout, 'hi')
  assert.equal(result.status, 3)
})

const crlfCopy = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'modspack-crlf-'))
  cpSync(DEFINITIONS_ROOT, dir, { recursive: true })
  const walk = d => {
    for (const e of readdirSync(d)) {
      const full = path.join(d, e)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(md|json)$/.test(e)) writeFileSync(full, readFileSync(full, 'utf8').replace(/\r?\n/g, '\r\n'))
    }
  }
  walk(dir)
  return dir
}

test('definitions: a CRLF checkout (Windows autocrlf) loads to the same skills and agents', () => {
  const dir = crlfCopy()
  try {
    assert.ok(readFileSync(path.join(dir, 'agents', 'code-reviewer.md'), 'utf8').includes('\r\n'), 'the copy really is CRLF')
    const problems = []
    const skills = loadSkills(dir, problems), agents = loadAgents(dir, problems)
    assert.deepEqual(problems, [])
    const lfSkills = loadSkills(DEFINITIONS_ROOT, []), lfAgents = loadAgents(DEFINITIONS_ROOT, [])
    assert.deepEqual(skills.map(s => [s.name, s.description, s.sections.map(x => x.heading)]), lfSkills.map(s => [s.name, s.description, s.sections.map(x => x.heading)]))
    assert.deepEqual(agents.map(a => [a.name, a.description, a.tools]), lfAgents.map(a => [a.name, a.description, a.tools]))
    assert.equal(readLf(path.join(dir, 'skills', 'wcag-audit', 'SKILL.md')), readFileSync(path.join(DEFINITIONS_ROOT, 'skills', 'wcag-audit', 'SKILL.md'), 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('package: the shipped definitions are LF in the repository (.gitattributes keeps Windows checkouts LF)', () => {
  assert.match(readFileSync(path.join(ROOT, '.gitattributes'), 'utf8'), /^\* text=auto eol=lf$/m)
  assert.ok(!readFileSync(path.join(DEFINITIONS_ROOT, 'agents', 'code-reviewer.md'), 'utf8').includes('\r'))
  assert.deepEqual(validatePackage(ROOT), [])
})
