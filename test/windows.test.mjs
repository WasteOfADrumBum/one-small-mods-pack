// Behaviour that differs on Windows, tested on every platform: command shims,
// CRLF checkouts and path separators. (A native Windows CI job runs the whole suite.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { DEFINITIONS_ROOT, SHELL_SAFE, loadAgents, loadSkills, npmCli, renderAll, readLf, spawnTool, validatePackage } from '../dist/lib.mjs'
import { ROOT } from './helpers.mjs'

test('exec: the npm entry is found beside node (the Windows layout) or from npm_execpath, and run with node, not a shell', () => {
  const entry = path.join('/opt/nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  assert.equal(npmCli(path.join('/opt/nodejs', 'node.exe'), {}, p => p === entry), entry)
  assert.equal(npmCli('/elsewhere/node', {}, () => false), undefined)
  // POSIX layout (nodejs.org tarballs, nvm): bin/node and lib/node_modules/npm, used when node --test runs outside npm.
  const posix = path.join('/opt/node/bin', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  assert.equal(npmCli('/opt/node/bin/node', {}, p => p === posix), posix)
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

// The working tree can be CRLF (a clone made before .gitattributes, or core.autocrlf on Windows), so these
// tests never assume it is LF: canonical content is what git holds in the index, or the working tree read
// through readLf, and a CRLF copy is made from that, never from raw bytes.
const lf = file => readLf(file)
const gitIndex = rel => {
  try {
    return execFileSync('git', ['show', `:${rel}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 10_000_000 }).toString('utf8')
  } catch {
    return undefined
  }
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
    // Same content whichever line endings the checkout has: compare through readLf on both sides.
    assert.equal(lf(path.join(dir, 'skills', 'wcag-audit', 'SKILL.md')), lf(path.join(DEFINITIONS_ROOT, 'skills', 'wcag-audit', 'SKILL.md')))
    assert.ok(!lf(path.join(dir, 'skills', 'wcag-audit', 'SKILL.md')).includes('\r'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('install: output rendered from a CRLF checkout is byte-identical to the LF one (installs and uninstalls stay deterministic)', () => {
  const dir = crlfCopy()
  try {
    const render = root => renderAll({ platforms: ['claude-code', 'codex', 'copilot', 'gemini'], agents: loadAgents(root, []), skills: loadSkills(root, []), ci: true, standalone: true })
    const fromCrlf = render(dir), fromLf = render(DEFINITIONS_ROOT)
    assert.deepEqual(fromCrlf, fromLf)
    for (const o of fromCrlf) if ('content' in o) assert.ok(!o.content.includes('\r'), `${o.path} has no CR`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('package: .gitattributes keeps definitions LF, and git holds them as LF whatever the working tree has', () => {
  assert.match(lf(path.join(ROOT, '.gitattributes')), /^\* text=auto eol=lf$/m)
  // The canonical content is the index: a working tree made by a CRLF checkout before .gitattributes
  // existed is not a repository defect, so it is not asserted on. Outside git (an npm tarball) the
  // shipped files are checked directly.
  const rel = 'mods/modspack-agents/agents/code-reviewer.md'
  const indexed = gitIndex(rel)
  if (indexed !== undefined) assert.ok(!indexed.includes('\r'), 'the index holds LF')
  else assert.ok(!readFileSync(path.join(ROOT, rel), 'utf8').includes('\r'), 'the shipped file is LF')
  assert.deepEqual(validatePackage(ROOT), [])
})
