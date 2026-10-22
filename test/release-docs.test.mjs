// Release bookkeeping: versions, changelog and marketplace agree.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { ROOT } from './helpers.mjs'

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const mods = readdirSync(path.join(ROOT, 'mods'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
const version = (mod) => JSON.parse(read(`mods/${mod}/.claude-plugin/plugin.json`)).version

test('the changelog has a heading for the package version', () => {
  const { version: pkg } = JSON.parse(read('package.json'))
  assert.ok(read('CHANGELOG.md').split('\n').some((line) => line === `## ${pkg}` || line.startsWith(`## ${pkg} `)))
})

test('the changelog states every mod version, since Claude Code updates a plugin only when its version changes', () => {
  const section = read('CHANGELOG.md').split('### Mod versions')[1]?.split('\n###')[0] ?? ''
  assert.ok(section, 'CHANGELOG.md needs a "### Mod versions" section')
  for (const mod of mods) {
    assert.ok(section.includes(`- \`${mod}\` ${version(mod)}\n`), `Mod versions needs the line "- \`${mod}\` ${version(mod)}"`)
  }
})

test('the marketplace lists exactly the mods in mods/', () => {
  const listed = JSON.parse(read('.claude-plugin/marketplace.json')).plugins.map((p) => p.name).sort()
  assert.deepEqual(listed, [...mods].sort())
})
