#!/usr/bin/env node
// End-to-end smoke test of the real npm artifact in a throwaway consumer project.
//
//   node scripts/consumer-smoke.mjs [--tarball <path>] [--keep]
//
// Packs this repository (unless --tarball is given), installs the tarball into a fresh git
// project that already holds unrelated files and its own AGENTS.md, and drives every CLI command
// through the installed bin with the Node that runs this script. It checks exit codes, preview
// safety, idempotent install, doctor, the hook guards, reversible uninstall (the tree must match
// the pre-install snapshot byte for byte) and that deterministic commands open no network
// connection. Prints one PASS/FAIL line per step; exits 1 on any failure.
//
// Needs only Node and npm: no Claude Code, no network after `npm pack`/install.

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const keep = args.includes('--keep')
const tarArg = args.includes('--tarball') ? path.resolve(args[args.indexOf('--tarball') + 1]) : null
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

// npm's own CLI script, run with this Node (avoids the Windows .cmd shim).
function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean)
  return candidates.find(c => c.endsWith('.js') && existsSync(c))
}
const NPM = npmCli()
if (!NPM) { console.error('BLOCKED: npm-cli.js not found next to this Node'); process.exit(3) }
const npm = (argv, cwd) => execFileSync(process.execPath, [NPM, ...argv], { cwd, encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] })

const results = []
const record = (ok, step, detail = '') => { results.push({ ok, step }); console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail ? `: ${detail}` : ''}`) }
const expect = (cond, step, detail) => record(Boolean(cond), step, cond ? '' : detail)

const work = mkdtempSync(path.join(tmpdir(), 'modspack-smoke-'))
const consumer = path.join(work, 'consumer')
mkdirSync(consumer)

// A preload that fails, and records, any outbound connection or DNS lookup from a guarded run.
const netLog = path.join(work, 'network.log')
const guard = path.join(work, 'no-network.cjs')
writeFileSync(guard, `
const fs = require('node:fs'), net = require('node:net'), dns = require('node:dns')
const log = what => { fs.appendFileSync(${JSON.stringify(netLog)}, what + '\\n'); const e = new Error('network disabled by consumer-smoke: ' + what); e.code = 'ENETUNREACH'; throw e }
const origConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...a) {
  const o = a[0]; const p = typeof o === 'object' && o ? o.path : (typeof o === 'string' ? o : null)
  if (p) return origConnect.apply(this, a) // local IPC/pipes are not network
  log('connect ' + JSON.stringify(typeof o === 'object' ? { host: o.host, port: o.port } : a.slice(0, 2)))
}
dns.lookup = (h) => log('dns ' + h)
if (dns.promises) dns.promises.lookup = async (h) => log('dns ' + h)
if (globalThis.fetch) globalThis.fetch = async (u) => log('fetch ' + String(u))
`)

try {
  // 1. Artifact
  let tarball = tarArg
  if (!tarball) {
    // Build first, then pack without lifecycle scripts: prepack's own output would corrupt the JSON.
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, stdio: 'ignore' })
    const [packed] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', work], ROOT))
    tarball = path.join(work, packed.filename)
  }
  const sha = createHash('sha256').update(readFileSync(tarball)).digest('hex')
  console.log(`artifact ${path.basename(tarball)} sha256 ${sha}`)
  console.log(`node ${process.version} on ${process.platform}-${process.arch}`)

  // 2. A consumer project with unrelated files and an existing user-owned AGENTS.md.
  const files = {
    'package.json': JSON.stringify({ name: 'smoke-consumer', version: '1.0.0', private: true, scripts: { test: 'node -e "process.exit(0)"' } }, null, 2) + '\n',
    'AGENTS.md': '# My project rules\n\nKeep this text exactly.\n',
    'src/index.js': 'export const answer = 42\n',
    'notes/todo.txt': 'unrelated file\n',
  }
  for (const [rel, body] of Object.entries(files)) { mkdirSync(path.dirname(path.join(consumer, rel)), { recursive: true }); writeFileSync(path.join(consumer, rel), body) }
  const git = a => execFileSync('git', a, { cwd: consumer, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q']); git(['add', '-A']); git(['-c', 'user.email=smoke@example.invalid', '-c', 'user.name=smoke', 'commit', '-qm', 'init'])
  npm(['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball], consumer)
  const bin = path.join(consumer, 'node_modules', pkg.name, 'dist', 'modspack.mjs')
  expect(existsSync(bin), 'installed bin entry exists', bin)

  const snapshot = () => {
    const out = {}
    const walk = dir => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else out[path.relative(consumer, full).split(path.sep).join('/')] = createHash('sha256').update(readFileSync(full)).digest('hex')
      }
    }
    walk(consumer)
    return out
  }
  const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]).sort()
  const before = snapshot()

  const run = (argv, { stdin, network = false } = {}) => {
    const env = { ...process.env }
    env.npm_config_update_notifier = 'false' // npm's own update check is not ModsPack network use
    if (!network) env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --require ${JSON.stringify(guard)}`.trim()
    const r = spawnSync(process.execPath, [bin, ...argv], { cwd: consumer, encoding: 'utf8', input: stdin ?? '', env, timeout: 120_000 })
    return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
  }
  const step = (name, argv, code, extra) => {
    const r = run(argv)
    const ok = r.code === code && (!extra || extra(r.out))
    record(ok, `${name} (exit ${code})`, ok ? '' : `exit ${r.code}: ${r.out.slice(0, 400)}`)
    return r
  }

  // 3. Reference commands
  step('--version', ['--version'], 0, o => o.includes(pkg.version))
  step('--help', ['--help'], 0, o => /Usage: modspack/.test(o))
  step('validate', ['validate'], 0, o => /PASS/.test(o))
  step('agents lists 6 roles', ['agents', '--json'], 0, o => JSON.parse(o).length === 6)
  step('skills lists 12', ['skills', '--json'], 0, o => JSON.parse(o).length === 12)
  step('unknown command is a usage error', ['bogus'], 2)
  step('unknown platform is a usage error', ['init', '--platform', 'nope'], 2)
  step('hook without platform is a usage error', ['hook'], 2)

  // 4. Install lifecycle
  step('inspect (read-only)', ['inspect'], 0)
  expect(diff(before, snapshot()).length === 0, 'inspect wrote nothing', diff(before, snapshot()).join(', '))
  step('init preview', ['init'], 0, o => /create/.test(o))
  expect(diff(before, snapshot()).length === 0, 'init preview wrote nothing', diff(before, snapshot()).join(', '))
  step('init --yes', ['init', '--yes'], 0)
  const installed = snapshot()
  const added = diff(before, installed)
  expect(added.length > 20 && added.includes('.modspack/manifest.json'), 'init installed files and a manifest', `changed: ${added.length}`)
  expect(readFileSync(path.join(consumer, 'AGENTS.md'), 'utf8').startsWith(files['AGENTS.md']), 'existing AGENTS.md text kept verbatim', 'user text changed')
  for (const rel of ['src/index.js', 'notes/todo.txt', 'package.json']) expect(installed[rel] === before[rel], `unrelated ${rel} untouched`, 'modified')
  step('init --yes again is a no-op', ['init', '--yes'], 0, o => /0 create, 0 update/.test(o))
  expect(diff(installed, snapshot()).length === 0, 'repeat install changed nothing', diff(installed, snapshot()).join(', '))
  step('doctor on a fresh install', ['doctor'], 0)

  // 5. Checks (deterministic; network guarded)
  step('check', ['check'], 0)
  step('security', ['security', '--no-history'], 0)
  step('privacy', ['privacy'], 0)
  step('accessibility (no UI files)', ['accessibility'], 0, o => /manual/i.test(o))
  step('release-check', ['release-check'], 0, o => /READY/.test(o))
  // A planted credential is a real finding. Built from parts so this file holds no secret.
  const planted = path.join(consumer, 'src', 'leak.js')
  writeFileSync(planted, `export const t = "${'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}"\n`)
  const sec = step('security finds a planted token', ['security', '--no-history'], 1, o => /github-token/.test(o))
  expect(!sec.out.includes('A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'), 'security output masks the token', 'raw token printed')
  rmSync(planted)

  // 6. Hook guards through the installed bin
  const awsKey = 'AKIA' + 'J7Q2M4X9B5N3R6TW'
  const codex = run(['hook', 'codex'], { stdin: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Add File: s.txt\n+k=${awsKey}\n*** End Patch` }, cwd: consumer }) })
  expect(codex.code === 0 && /"deny"/.test(codex.out) && !codex.out.includes(awsKey), 'hook codex denies an AWS key, masked', codex.out.slice(0, 300))
  const codexOk = run(['hook', 'codex'], { stdin: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: a.txt\n+hello\n*** End Patch' }, cwd: consumer }) })
  expect(codexOk.code === 0 && codexOk.out === '', 'hook codex allows a clean patch', codexOk.out.slice(0, 300))
  const gem = run(['hook', 'gemini'], { stdin: JSON.stringify({ tool_name: 'write_file', tool_input: { file_path: 'src/u.js', content: `const ssn = "${'512' + '-38-' + '4021'}"` } }) })
  expect(/"deny"/.test(gem.out) && !gem.out.includes('512' + '-38-' + '4021'), 'hook gemini denies personal data, masked', gem.out.slice(0, 300))
  const cop = run(['hook', 'copilot'], { stdin: JSON.stringify({ toolName: 'create', toolArgs: { path: 'src/k.js', file_text: `const k = "${awsKey}"` }, cwd: consumer }) })
  expect(cop.code === 2 && !cop.out.includes(awsKey), 'hook copilot denies with exit 2, masked', `exit ${cop.code}`)
  const bad = run(['hook', 'codex'], { stdin: 'not json' })
  expect(bad.code === 0, 'hook with malformed input fails open (documented), exit 0', `exit ${bad.code}`)

  expect(!existsSync(netLog), 'deterministic commands opened no network connection', existsSync(netLog) ? readFileSync(netLog, 'utf8') : '')

  // 7. Reversible uninstall
  step('uninstall preview', ['uninstall'], 0, o => /remove/.test(o))
  expect(diff(installed, snapshot()).length === 0, 'uninstall preview wrote nothing', diff(installed, snapshot()).join(', '))
  step('uninstall --yes', ['uninstall', '--yes'], 0)
  const after = snapshot()
  expect(diff(before, after).length === 0, 'uninstall restored the pre-install tree exactly', diff(before, after).join(', '))
  step('uninstall again is harmless', ['uninstall', '--yes'], 0)
} catch (e) {
  record(false, 'smoke harness', e.stack ?? String(e))
} finally {
  if (keep) console.log(`kept ${work}`)
  else rmSync(work, { recursive: true, force: true })
}

const failed = results.filter(r => !r.ok)
console.log(`\n${failed.length ? 'FAIL' : 'PASS'}: ${results.length - failed.length}/${results.length} consumer smoke steps (node ${process.version}, ${process.platform})`)
process.exit(failed.length ? 1 : 0)
