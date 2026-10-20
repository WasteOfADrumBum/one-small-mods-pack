import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  splitFrontmatter, FrontmatterError, validate, schema, resolveConfig, loadConfig, ConfigError,
  loadSkills, loadAgents, validatePackage, gateStatus, exitCode, mask, unsupportedKeywords,
} from '../dist/lib.mjs'
import { ROOT, project, cli } from './helpers.mjs'

test('frontmatter: reads scalars, quotes, folded blocks, lists and maps', () => {
  const { data, body } = splitFrontmatter([
    '---',
    'name: code-review',
    'description: >',
    '  Reviews a change',
    '  for defects.',
    'license: "MIT"',
    "quoted: 'it''s'",
    'tools:',
    '  - Read',
    '  - Grep',
    'metadata:',
    '  modspack-category: review',
    '---',
    '# Body',
  ].join('\n'))
  assert.deepEqual(data, { name: 'code-review', description: 'Reviews a change for defects.', license: 'MIT', quoted: "it's", tools: ['Read', 'Grep'], metadata: { 'modspack-category': 'review' } })
  assert.equal(body, '# Body')
})

test('frontmatter: rejects what it does not understand', () => {
  assert.throws(() => splitFrontmatter('name: x\n'), FrontmatterError)
  assert.throws(() => splitFrontmatter('---\nname: x\n'), /not closed/)
  assert.throws(() => splitFrontmatter('---\nname: [a, b]\n---\n'), /unsupported YAML/)
  assert.throws(() => splitFrontmatter('---\nname: a\nname: b\n---\n'), /duplicate key/)
  assert.throws(() => splitFrontmatter('---\nx:\n  - a\n  b: c\n---\n'), /mixes a list and a map/)
})

test('schema: validates types, enums, unknown keys and ranges', () => {
  assert.deepEqual(validate({ mode: 'enforce' }, schema), [])
  assert.match(validate({ mode: 'loud' }, schema)[0], /\$\.mode: must be one of/)
  assert.match(validate({ nope: 1 }, schema)[0], /unknown key "nope"/)
  assert.match(validate({ security: { history: { maxCommits: 0 } } }, schema)[0], /at least 1/)
  assert.match(validate({ security: { accepted: [{ reason: 'x' }] } }, schema)[0], /missing required key "fingerprint"/)
  assert.deepEqual(unsupportedKeywords(schema), [])
})

test('config: defaults, overrides and actionable errors', () => {
  const config = resolveConfig({})
  assert.equal(config.mode, 'enforce')
  assert.equal(config.security.failOn, 'high')
  assert.equal(config.security.dependencyAudit, false)
  assert.equal(config.privacy.hipaa, 'auto')
  assert.deepEqual(config.release.requiredGates, ['quality', 'security', 'privacy', 'accessibility', 'package'])
  assert.equal(resolveConfig({ security: { failOn: 'medium' } }).security.failOn, 'medium')
  assert.throws(() => resolveConfig({ guards: { quality: 'yes' } }), /\$\.guards\.quality: expected boolean/)

  const bad = project({ 'modspack.config.json': '{ nope' })
  try {
    assert.throws(() => loadConfig(bad.dir), ConfigError)
  } finally {
    bad.cleanup()
  }
})

test('definitions: the shipped package validates', () => {
  assert.deepEqual(validatePackage(ROOT), [])
})

test('definitions: catches spec violations in skills and agents', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'modspack-defs-'))
  try {
    mkdirSync(path.join(dir, 'skills', 'Bad_Name'), { recursive: true })
    writeFileSync(path.join(dir, 'skills', 'Bad_Name', 'SKILL.md'), '---\nname: Bad_Name\ndescription: x\nauthor: me\n---\n## Steps\nsee [ref](references/missing.md)\n')
    mkdirSync(path.join(dir, 'agents'))
    writeFileSync(path.join(dir, 'agents', 'helper.md'), '---\nname: other\ndescription: Helps.\ntools: Read, Teleport\n---\n')
    const problems = []
    loadSkills(dir, problems)
    loadAgents(dir, problems)
    const messages = problems.map(p => p.message).join('\n')
    assert.match(messages, /name "Bad_Name" must be 1-64 lowercase/)
    assert.match(messages, /unknown frontmatter field "author"/)
    assert.match(messages, /missing "## When to use" section/)
    assert.match(messages, /links to references\/missing.md, which does not exist/)
    assert.match(messages, /name "other" must match the file name/)
    assert.match(messages, /unknown tool "Teleport"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('definitions: a read-only reviewer may not hold write tools, and catalogs must cover every mod', () => {
  const copy = mkdtempSync(path.join(tmpdir(), 'modspack-pkg-'))
  try {
    for (const entry of ['mods', 'catalog', 'schema', '.claude-plugin', 'package.json']) cpSync(path.join(ROOT, entry), path.join(copy, entry), { recursive: true })
    const agent = path.join(copy, 'mods', 'modspack-agents', 'agents', 'code-reviewer.md')
    writeFileSync(agent, (await_read(agent)).replace(/^tools: .*$/m, 'tools: Read, Grep, Edit'))
    const guards = JSON.parse(await_read(path.join(copy, 'catalog', 'guards.json'))).filter(g => g.name !== 'qa-gate')
    writeFileSync(path.join(copy, 'catalog', 'guards.json'), JSON.stringify(guards))
    const messages = validatePackage(copy).map(p => p.message).join('\n')
    assert.match(messages, /code-reviewer is a read-only reviewer and may not list Edit/)
    assert.match(messages, /mod qa-gate is in the marketplace but not documented/)
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
})

import { readFileSync } from 'node:fs'
function await_read(file) {
  return readFileSync(file, 'utf8')
}

test('report: gate status never turns a blocked or missing check into a pass', () => {
  const check = (status, required = true) => ({ name: 'x', status, summary: '', required })
  assert.equal(gateStatus([check('PASS'), check('PASS')]), 'PASS')
  assert.equal(gateStatus([check('PASS'), check('FAIL')]), 'FAIL')
  assert.equal(gateStatus([check('PASS'), check('BLOCKED')]), 'BLOCKED')
  assert.equal(gateStatus([check('PASS'), check('NOT_TESTED')]), 'BLOCKED')
  assert.equal(gateStatus([check('PASS'), check('BLOCKED', false)]), 'PARTIAL')
  assert.equal(gateStatus([check('SKIPPED'), check('SKIPPED')]), 'SKIPPED')
  assert.equal(exitCode([{ gate: 'a', status: 'FAIL', checks: [] }], 'enforce'), 1)
  assert.equal(exitCode([{ gate: 'a', status: 'FAIL', checks: [] }], 'advisory'), 0)
  assert.equal(exitCode([{ gate: 'a', status: 'BLOCKED', checks: [] }], 'advisory'), 3)
  assert.equal(mask('hunter2hunter2hunter2'), '[masked, 21 chars]')
})

test('cli: version, help, unknown commands and bad flags', async () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal((await cli(['--version'], ROOT)).out, pkg.version)
  assert.match((await cli(['--help'], ROOT)).out, /Usage: modspack <command>/)
  assert.equal((await cli(['frobnicate'], ROOT)).code, 2)
  assert.equal((await cli(['inspect', '--dir'], ROOT)).code, 2)
  const valid = await cli(['validate'], ROOT)
  assert.equal(valid.code, 0, valid.out)
})
