// Runs `claude plugin validate` or `claude plugin test` over the repository and every mod, the same on
// Windows, macOS and Linux. It replaces POSIX shell loops in package.json (`for mod in mods/*/; ...`),
// which Windows' npm shell cannot parse ("mod was unexpected at this time.").
//
//   node scripts/run-mods.mjs validate   the root plugin, then every mods/<name>/
//   node scripts/run-mods.mjs test       `plugin test` in every mods/<name>/ that has a tests/ folder
//
// Stops at the first failure and exits with that command's status. Exit 3: the `claude` command was not found.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { projectRoot } from './root.mjs'

export const MODES = ['validate', 'test']

/** The directories to run on, as repository-relative POSIX paths ("." is the root plugin). */
export function targets(mode, root) {
  const modsDir = path.join(root, 'mods')
  const mods = existsSync(modsDir)
    ? readdirSync(modsDir)
        .filter(name => statSync(path.join(modsDir, name)).isDirectory())
        .sort()
    : []
  if (mode === 'validate') return ['.', ...mods.map(name => `mods/${name}`)]
  return mods.filter(name => existsSync(path.join(modsDir, name, 'tests'))).map(name => `mods/${name}`)
}

/** One argument array per run: never a shell string. */
export const commands = (mode, root) => targets(mode, root).map(target => ({ target, args: ['plugin', mode, target] }))

/** Finds a command on PATH the way the platform would: PATHEXT on Windows, the execute bit elsewhere. */
export function resolveCommand(name, { env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const win = platform === 'win32'
  const p = win ? path.win32 : path.posix
  const dirs = (env.PATH ?? env.Path ?? '').split(win ? ';' : ':').filter(Boolean)
  const exts = win ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : ['']
  for (const dir of dirs) for (const ext of exts) {
    const candidate = p.join(dir.replace(/^"|"$/g, ''), name + ext)
    if (exists(candidate)) return candidate
  }
  return undefined
}

// Characters cmd.exe would interpret even inside double quotes.
const CMD_UNSAFE = /["%&|<>^!\r\n]/

/** The spawn call for a resolved command: `.exe` and POSIX files run directly; Windows `.cmd`/`.bat` shims need cmd.exe. */
export function spawnPlan(file, args, platform = process.platform) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    const bad = [file, ...args].find(part => CMD_UNSAFE.test(part))
    if (bad !== undefined) throw new Error(`refusing to pass ${JSON.stringify(bad)} through cmd.exe`)
    return { file: [file, ...args].map(part => `"${part}"`).join(' '), args: [], shell: true }
  }
  return { file, args, shell: false }
}

/** Runs each command in order and stops at the first failure; returns the exit status. */
export function runAll(list, run, log = () => {}) {
  for (const { target, args } of list) {
    log(`==> claude ${args.join(' ')}`)
    const status = run(args, target)
    if (status !== 0) {
      log(`FAIL: claude ${args.join(' ')} exited ${status}`)
      return status
    }
  }
  return 0
}

export function main(argv, { root = projectRoot(import.meta.url), env = process.env, platform = process.platform } = {}) {
  const mode = argv[0]
  if (!MODES.includes(mode ?? '')) {
    console.error(`usage: node scripts/run-mods.mjs <${MODES.join('|')}>`)
    return 2
  }
  const claude = resolveCommand('claude', { env, platform })
  if (claude === undefined) {
    console.error('BLOCKED: the `claude` command was not found on PATH. Install Claude Code and sign in, then run this again.')
    return 3
  }
  const list = commands(mode, root)
  if (list.length === 0) {
    console.error(`no mods to ${mode} under ${path.join(root, 'mods')}`)
    return 3
  }
  const run = args => {
    const plan = spawnPlan(claude, args, platform)
    const result = spawnSync(plan.file, plan.args, { cwd: root, env, stdio: 'inherit', shell: plan.shell })
    if (result.error) {
      console.error(`could not run claude: ${result.error.message}`)
      return 3
    }
    return result.status ?? 1
  }
  return runAll(list, run, line => console.error(line))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
