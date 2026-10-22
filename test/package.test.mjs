import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { npmCli } from '../dist/lib.mjs'
import { ROOT, project } from './helpers.mjs'

test('npm artifact: the installed tarball validates and installs all platform definitions', () => {
  const p = project({ 'package.json': '{"private":true}' })
  try {
    const npm = npmCli()
    assert.ok(npm, 'npm must be available to verify the release artifact')
    const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8', timeout: 120_000 })
    const [packed] = JSON.parse(runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', p.dir], ROOT))
    assert.ok(packed.files.some(f => f.path === '.claude-plugin/marketplace.json'))
    runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(p.dir, packed.filename)], p.dir)
    const entry = path.join(p.dir, 'node_modules', 'one-small-modspack', 'dist', 'modspack.mjs')
    const run = args => execFileSync(process.execPath, [entry, ...args], { cwd: p.dir, encoding: 'utf8', timeout: 30_000 })
    assert.match(run(['validate']), /valid/i)
    run(['init', '--platform', 'codex,copilot,gemini,claude-code', '--standalone', '--yes'])
    assert.doesNotThrow(() => run(['doctor']))
  } finally {
    p.cleanup()
  }
})
