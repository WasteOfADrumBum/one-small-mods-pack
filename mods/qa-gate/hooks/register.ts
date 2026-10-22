import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { asBool, asList, asNumber, asString, parseConfigText, pick } from './config'
import type { RawConfig } from './config'
import { bashWrites, changedFiles, porcelainPaths } from './bash-writes'
import { CHECKS, LOCKFILES, failureMessage, planScripts, scopeArgs, scriptArgv } from './scripts'
import type { Check, Failure, PackageManager } from './scripts'

type Settings = {
  enabled: boolean
  packageJson: string
  packageManager: PackageManager | 'auto'
  checks: Check[]
  scriptNames: Partial<Record<Check, string[]>>
  codeExtensions: string[]
  maxAttempts: number
  timeoutMs: number
  scope: 'all' | 'changed'
  testArgs: string[] | undefined
  watchBash: boolean
}

const DEFAULT_CODE = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.astro', '.css', '.scss', '.html', '.json', '.md', '.mdx']

/** Reads a JSON config file of the project; a missing or broken one is empty. */
async function readConfigFile($: EngineInterface, path: string): Promise<RawConfig> {
  if (path.trim() === '' || !(await $.fs.exists(path))) return {}
  const parsed = parseConfigText(path, await $.fs.read(path))
  if (typeof parsed === 'string') {
    $.ui.log(parsed)
    return {}
  }
  return parsed
}

async function load($: EngineInterface, options: PluginOptions): Promise<Settings> {
  const configFile = asString(options.configFile) ?? '.claude/guardrail-mods/qa-gate.json'
  const file = await readConfigFile($, configFile)
  const manager = pick(file, options, 'packageManager', 'auto', asString)
  const names: Partial<Record<Check, string[]>> = {}
  const scripts = typeof file.scripts === 'object' && file.scripts !== null ? (file.scripts as RawConfig) : {}
  for (const check of CHECKS) {
    const list = asList(scripts[check])
    if (list !== undefined) names[check] = list
  }
  return {
    enabled: pick(file, options, 'enabled', true, asBool),
    packageJson: pick(file, options, 'packageJson', 'package.json', asString),
    packageManager: (['npm', 'pnpm', 'yarn', 'bun'] as const).find(m => m === manager) ?? 'auto',
    checks: pick(file, options, 'checks', [...CHECKS], asList).filter((c): c is Check => (CHECKS as readonly string[]).includes(c)),
    scriptNames: names,
    codeExtensions: pick(file, options, 'codeExtensions', DEFAULT_CODE, asList).map(x => x.toLowerCase()),
    maxAttempts: pick(file, options, 'maxAttempts', 3, asNumber),
    // timeoutSeconds is the /config option; timeoutMs is kept for project files.
    timeoutMs: asNumber(file.timeoutMs) ?? pick(file, options, 'timeoutSeconds', 300, asNumber) * 1000,
    scope: pick(file, options, 'scope', 'all', asString) === 'changed' ? 'changed' : 'all',
    testArgs: asList(file.testArgs) ?? asList(options.testArgs),
    watchBash: pick(file, options, 'watchBash', true, asBool),
  }
}

async function detectManager($: EngineInterface, dir: string): Promise<PackageManager> {
  for (const [lockfile, manager] of LOCKFILES) {
    if (await $.fs.exists(`${dir}${lockfile}`)) return manager
  }
  return 'npm'
}

// The code files Claude changed since the gate last passed (the gate runs
// only when there are some), and how many times in a row it has held the turn.
const changed = new Set<string>()
let attempts = 0

// The repository root, once found; null outside a git repository.
let gitRoot: string | null | undefined

/** Files with uncommitted changes that pass `keep`, by absolute path, stamped with mtime and size; undefined outside git. */
async function dirtyFiles($: EngineInterface, keep: (path: string) => boolean): Promise<Map<string, string> | undefined> {
  if (gitRoot === undefined) {
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 10_000 }).catch(() => undefined)
    gitRoot = top !== undefined && top.exitCode === 0 ? top.stdout.trim() : null
  }
  if (gitRoot === null) return undefined
  const status = await $.process.run(['git', 'status', '--porcelain', '-z', '--untracked-files=all'], { timeoutMs: 10_000 }).catch(() => undefined)
  if (status === undefined || status.exitCode !== 0) return undefined
  const files = new Map<string, string>()
  for (const rel of porcelainPaths(status.stdout).filter(keep).slice(0, 500)) {
    const path = `${gitRoot}/${rel}`
    const stat = await $.fs.stat(path).catch(() => undefined)
    if (stat !== undefined && stat.kind === 'file') files.set(path, `${stat.mtimeMs}:${stat.size}`)
  }
  return files
}

/** Runs the gate: undefined when every script passes or none applies, else what Claude must fix. */
async function runGate($: EngineInterface, settings: Settings): Promise<string | undefined> {
  if (!(await $.fs.exists(settings.packageJson))) {
    $.ui.status(`🧪 qa-gate: no ${settings.packageJson}, nothing to run`)
    return undefined
  }
  const pkg = parseConfigText(settings.packageJson, await $.fs.read(settings.packageJson))
  if (typeof pkg === 'string') {
    $.ui.log(pkg)
    return undefined
  }
  const scripts = typeof pkg.scripts === 'object' && pkg.scripts !== null ? (pkg.scripts as RawConfig) : {}
  const plan = planScripts(scripts, settings.scriptNames, settings.checks)
  if (plan.length === 0) {
    $.ui.status(`🧪 qa-gate: no ${settings.checks.join(', ')} scripts in ${settings.packageJson}`)
    return undefined
  }

  const cut = settings.packageJson.lastIndexOf('/')
  const dir = cut < 0 ? '' : settings.packageJson.slice(0, cut + 1)
  const manager = settings.packageManager === 'auto' ? await detectManager($, dir) : settings.packageManager

  // In `changed` scope, lint, spell check and (with testArgs) tests get only the changed files that still exist.
  const files: string[] = []
  if (settings.scope === 'changed') {
    for (const file of changed) if (await $.fs.exists(file)) files.push(file)
  }

  const failures: Failure[] = []
  const commands = new Map<string, string>()
  for (const { check, script } of plan) {
    const argv = scriptArgv(manager, script, scopeArgs(check, files, settings.testArgs))
    commands.set(script, argv.join(' '))
    $.ui.status(`🧪 qa-gate: running ${script}…`)
    const started = Date.now()
    try {
      const ran = await $.process.run(argv, {
        cwd: dir === '' ? undefined : dir,
        env: { CI: 'true', FORCE_COLOR: '0' },
        timeoutMs: settings.timeoutMs,
      })
      if (ran.exitCode !== 0) {
        failures.push({ check, script, exitCode: ran.exitCode, output: `${ran.stdout}\n${ran.stderr}` })
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      failures.push({
        check,
        script,
        exitCode: -1,
        // The engine rejects when the command is still running at the timeout.
        output: /tim(ed|e) ?out|still running/i.test(reason) || Date.now() - started >= settings.timeoutMs - 1000
          ? `${script} did not finish within ${Math.round(settings.timeoutMs / 1000)}s (raise timeoutSeconds, or set scope to "changed"): ${reason}`
          : reason,
      })
    }
  }

  // Say which checks had no script, so a missing one never reads as a pass.
  const missing = settings.checks.filter(check => !plan.some(p => p.check === check))
  const none = missing.length > 0 ? ` · no ${missing.join(', ')} script` : ''
  const passed = plan.length - failures.length
  $.ui.status(
    failures.length === 0
      ? `✅ qa-gate: ${passed}/${plan.length} passed${none}`
      : `❌ qa-gate: ${failures.map(f => f.script).join(', ')} failed${none}`,
  )
  return failures.length === 0 ? undefined : failureMessage(failures, script => commands.get(script) ?? script)
}

export const register: Register = (on, options) => {
  on('tool.call', { tool: ['Write', 'Edit', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    // Tool arguments arrive as JSON from the model: a path that is not a string is not a change to record.
    const path = asString(e.tool === 'NotebookEdit' ? e.notebook_path : e.tool === 'Write' || e.tool === 'Edit' ? e.file_path : '')
    if (path === undefined) return ran
    const settings = await load($, options)
    if (settings.codeExtensions.some(ext => path.toLowerCase().endsWith(ext))) changed.add(path)
    return ran
  })

  // Code changed through the shell counts too: what the command names as
  // written, and what git shows changed while it ran.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const settings = await load($, options)
    if (!settings.enabled || !settings.watchBash) return next(e)
    const isCode = (path: string) => settings.codeExtensions.some(ext => path.toLowerCase().endsWith(ext))

    const before = await dirtyFiles($, isCode)
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const after = before === undefined ? undefined : await dirtyFiles($, isCode)
    if (before !== undefined && after !== undefined) for (const file of changedFiles(before, after)) changed.add(file)
    const command = asString(e.command)
    if (command !== undefined) for (const write of bashWrites(command)) if (isCode(write.path)) changed.add(write.path)
    return ran
  })

  on('classic.Stop', async ($, e, next) => {
    const settings = await load($, options)
    if (!settings.enabled || changed.size === 0) return next(e)

    const problems = await runGate($, settings)
    if (problems === undefined) {
      changed.clear()
      attempts = 0
      return next(e)
    }
    attempts += 1
    if (attempts > settings.maxAttempts) {
      $.ui.toast(`qa-gate: still failing after ${settings.maxAttempts} tries; letting the turn end`)
      // Start over on the next code change rather than holding every later turn.
      changed.clear()
      attempts = 0
      return next(e)
    }
    return { block: problems }
  })
}
