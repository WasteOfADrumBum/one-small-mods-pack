import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
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
    const shipped = new Set(packed.files.map(f => f.path))
    assert.ok(shipped.has('.claude-plugin/marketplace.json'))
    for (const required of ['README.md', 'LICENSE', 'CHANGELOG.md', 'package.json', 'dist/modspack.mjs']) assert.ok(shipped.has(required), `${required} missing from tarball`)
    // Plugin hook modules and helper scripts are the runtime of the guard mods; a bare directory
    // pattern in package.json "files" silently drops them, so compare against what is on disk.
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
    const onDisk = []
    for (const mod of readdirSync(path.join(ROOT, 'mods'))) {
      for (const sub of ['hooks', 'scripts']) {
        const dir = path.join(ROOT, 'mods', mod, sub)
        if (existsSync(dir)) onDisk.push(...walk(dir).map(f => path.relative(ROOT, f).split(path.sep).join('/')))
      }
    }
    assert.ok(onDisk.length >= 20, 'expected to find the guard mods hook modules on disk')
    assert.deepEqual(onDisk.filter(f => !shipped.has(f)), [], 'hook/script runtime files missing from the tarball')
    // The release workflow refuses a tarball whose file list differs from release/package-files.txt.
    const expected = readFileSync(path.join(ROOT, 'release', 'package-files.txt'), 'utf8').split(/\r?\n/).filter(Boolean).sort()
    assert.deepEqual([...shipped].sort(), expected, 'release/package-files.txt is out of date: regenerate it from npm pack --dry-run --json')
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
