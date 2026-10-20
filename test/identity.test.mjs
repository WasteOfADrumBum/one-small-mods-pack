// Agent identities: friendly display names are metadata. The six technical
// IDs, the agent files and every native format stay exactly as they were.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { DEFINITIONS_ROOT, loadAgents, loadDefaultIdentities, resolveIdentities, validatePackage, ConfigError } from '../dist/lib.mjs'
import { ROOT, project, cli } from './helpers.mjs'

const IDS = ['accessibility-auditor', 'code-reviewer', 'qa-engineer', 'release-engineer', 'release-manager', 'security-privacy-auditor']
const NAMES = { 'release-manager': 'Atlas', 'code-reviewer': 'Sentinel', 'qa-engineer': 'Scout', 'accessibility-auditor': 'Echo', 'security-privacy-auditor': 'Aegis', 'release-engineer': 'Forge' }
const ROLES = { 'release-manager': 'Release Manager', 'code-reviewer': 'Code Reviewer', 'qa-engineer': 'QA Engineer', 'accessibility-auditor': 'Accessibility Auditor', 'security-privacy-auditor': 'Security & Privacy Auditor', 'release-engineer': 'Release Engineer' }

const agents = () => loadAgents(DEFINITIONS_ROOT, [])
const defaults = () => loadDefaultIdentities(DEFINITIONS_ROOT)

test('identity: the six technical IDs are unchanged and match their files', () => {
  assert.deepEqual(agents().map(a => a.name).sort(), IDS)
  for (const id of IDS) assert.ok(existsSync(path.join(DEFINITIONS_ROOT, 'agents', `${id}.md`)), id)
  // The canonical agent files never mention a display name: identity is metadata beside them.
  for (const id of IDS) {
    const text = readFileSync(path.join(DEFINITIONS_ROOT, 'agents', `${id}.md`), 'utf8')
    for (const name of Object.values(NAMES)) assert.ok(!new RegExp(`\\b${name}\\b`).test(text), `${id}.md mentions ${name}`)
  }
})

test('identity: default names and roles are the approved ones, and the package validates', () => {
  const resolved = resolveIdentities(agents(), defaults())
  assert.deepEqual(Object.fromEntries(resolved.map(i => [i.id, i.name])), NAMES)
  assert.deepEqual(Object.fromEntries(resolved.map(i => [i.id, i.role])), ROLES)
  assert.ok(resolved.every(i => !i.custom))
  assert.deepEqual(validatePackage(ROOT), [])
})

test('identity: overrides rename the display name only, and are validated', () => {
  const resolved = resolveIdentities(agents(), defaults(), { 'release-manager': 'Mercury' })
  const rm = resolved.find(i => i.id === 'release-manager')
  assert.deepEqual({ id: rm.id, name: rm.name, role: rm.role, custom: rm.custom }, { id: 'release-manager', name: 'Mercury', role: 'Release Manager', custom: true })
  assert.throws(() => resolveIdentities(agents(), defaults(), { nobody: 'X' }), ConfigError)
  assert.throws(() => resolveIdentities(agents(), defaults(), { 'qa-engineer': 'Atlas' }), /unique/)
  assert.throws(() => resolveIdentities(agents(), defaults(), { 'qa-engineer': 'atlas' }), /unique/)
  assert.throws(() => resolveIdentities(agents(), defaults(), { 'qa-engineer': 'code-reviewer' }), /technical ID/)
  for (const bad of ['', '1abc', 'a'.repeat(33), 'a<b>', 'x\ny', 'quote"d']) assert.throws(() => resolveIdentities(agents(), defaults(), { 'qa-engineer': bad }), /display name/, JSON.stringify(bad))
  // Renaming an agent to another agent's old default is fine once that one is renamed too.
  assert.doesNotThrow(() => resolveIdentities(agents(), defaults(), { 'qa-engineer': 'Atlas', 'release-manager': 'Mercury' }))
})

test('identity: the CLI lists display name, ID and role, and honours modspack.config.json', async () => {
  const p = project({ 'package.json': '{"name":"x","version":"1.0.0"}' })
  try {
    const plain = await cli(['agents', '--json'], p.dir)
    assert.equal(plain.code, 0)
    const rows = JSON.parse(plain.out)
    assert.deepEqual(rows.map(r => r.id).sort(), IDS)
    assert.deepEqual(Object.fromEntries(rows.map(r => [r.id, r.displayName])), NAMES)
    assert.match((await cli(['agents'], p.dir)).out, /Atlas \(release-manager\), Release Manager/)

    writeFileSync(path.join(p.dir, 'modspack.config.json'), JSON.stringify({ agentNames: { 'release-manager': 'Mercury', 'code-reviewer': 'Hawk eye' } }))
    const custom = JSON.parse((await cli(['agents', '--json'], p.dir)).out)
    assert.equal(custom.find(r => r.id === 'release-manager').displayName, 'Mercury')
    assert.equal(custom.find(r => r.id === 'code-reviewer').displayName, 'Hawk eye')
    assert.equal(custom.find(r => r.id === 'qa-engineer').displayName, 'Scout')
    assert.deepEqual(custom.map(r => r.id), rows.map(r => r.id))

    for (const bad of [{ agentNames: { nobody: 'X' } }, { agentNames: { 'qa-engineer': 'Mercury', 'release-manager': 'Mercury' } }, { agentNames: { 'qa-engineer': 7 } }]) {
      writeFileSync(path.join(p.dir, 'modspack.config.json'), JSON.stringify(bad))
      const run = await cli(['agents'], p.dir)
      assert.equal(run.code, 2, JSON.stringify(bad))
    }
  } finally {
    p.cleanup()
  }
})

const tree = (dir, skip) => {
  const out = {}
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) { if (e.name !== '.git') walk(full) } else if (!skip.test(path.relative(dir, full))) out[path.relative(dir, full)] = readFileSync(full, 'utf8')
    }
  }
  walk(dir)
  return out
}

test('identity: custom names change no native agent file, skill, hook or permission; only the instruction block', async () => {
  const a = project({ 'package.json': '{"name":"x","version":"1.0.0"}' })
  const b = project({ 'package.json': '{"name":"x","version":"1.0.0"}', 'modspack.config.json': JSON.stringify({ agentNames: { 'release-manager': 'Mercury', 'security-privacy-auditor': 'Warden' } }) })
  try {
    for (const p of [a, b]) assert.equal((await cli(['init', '--yes', '--platform', 'claude-code,codex,copilot,gemini', '--standalone'], p.dir)).code, 0)
    const skip = /^(\.modspack\/|modspack\.config\.json$|AGENTS\.md$|CLAUDE\.md$|GEMINI\.md$)/
    const ta = tree(a.dir, skip), tb = tree(b.dir, skip)
    assert.deepEqual(Object.keys(tb).sort(), Object.keys(ta).sort())
    for (const f of Object.keys(ta)) assert.equal(tb[f], ta[f], `${f} differs`)
    // Native agent files are keyed by the technical ID in every format.
    for (const id of IDS) {
      assert.ok(ta[`.codex/agents/${id}.toml`].includes(`name = "${id}"`))
      assert.ok(ta[`.github/agents/${id}.agent.md`] !== undefined && ta[`.gemini/agents/${id}.md`] !== undefined && ta[`.claude/agents/${id}.md`] !== undefined)
    }
    const block = readFileSync(path.join(b.dir, 'AGENTS.md'), 'utf8')
    assert.match(block, /Mercury \(`release-manager`, Release Manager\)/)
    assert.match(block, /Warden \(`security-privacy-auditor`/)
    assert.match(block, /Sentinel \(`code-reviewer`/)
    assert.match(readFileSync(path.join(a.dir, 'AGENTS.md'), 'utf8'), /Atlas \(`release-manager`, Release Manager\)/)
    // A rename and re-init updates the block in place; uninstall still restores the project.
    writeFileSync(path.join(b.dir, 'modspack.config.json'), JSON.stringify({ agentNames: { 'release-manager': 'Apollo' } }))
    assert.equal((await cli(['init', '--yes', '--platform', 'codex'], b.dir)).code, 0)
    assert.match(readFileSync(path.join(b.dir, 'AGENTS.md'), 'utf8'), /Apollo \(`release-manager`/)
    const doctor = await cli(['doctor'], b.dir)
    assert.ok(!/FAIL (?!hook command)/.test(doctor.out), doctor.out)
  } finally {
    a.cleanup()
    b.cleanup()
  }
})

test('identity: uninstall after a customised install removes only what was installed', async () => {
  const p = project({ 'package.json': '{"name":"x","version":"1.0.0"}', 'AGENTS.md': '# Mine\nkeep this\n', 'modspack.config.json': JSON.stringify({ agentNames: { 'qa-engineer': 'Probe' } }) })
  try {
    const before = tree(p.dir, /^$/)
    assert.equal((await cli(['init', '--yes', '--platform', 'codex'], p.dir)).code, 0)
    assert.equal((await cli(['uninstall', '--yes'], p.dir)).code, 0)
    assert.deepEqual(tree(p.dir, /^$/), before)
  } finally {
    p.cleanup()
  }
})
