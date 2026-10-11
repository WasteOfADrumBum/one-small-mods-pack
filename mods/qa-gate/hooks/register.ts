import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { asBool, asList, asNumber, asString, parseConfigText, pick } from './config'
import type { RawConfig } from './config'
import { CHECKS, LOCKFILES, failureMessage, planScripts, scriptArgv } from './scripts'
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
    timeoutMs: pick(file, options, 'timeoutMs', 300_000, asNumber),
  }
}

async function detectManager($: EngineInterface, dir: string): Promise<PackageManager> {
  for (const [lockfile, manager] of LOCKFILES) {
    if (await $.fs.exists(`${dir}${lockfile}`)) return manager
  }
  return 'npm'
}

// Whether Claude changed code since the gate last passed, and how many
// times in a row the gate has held the turn.
let isDirty = false
let attempts = 0

/** Runs the gate: undefined when every script passes or none applies, else what Claude must fix. */
async function runGate($: EngineInterface, settings: Settings): Promise<string | undefined> {
  if (!(await $.fs.exists(settings.packageJson))) return undefined
  const pkg = parseConfigText(settings.packageJson, await $.fs.read(settings.packageJson))
  if (typeof pkg === 'string') {
    $.ui.log(pkg)
    return undefined
  }
  const scripts = typeof pkg.scripts === 'object' && pkg.scripts !== null ? (pkg.scripts as RawConfig) : {}
  const plan = planScripts(scripts, settings.scriptNames, settings.checks)
  if (plan.length === 0) return undefined

  const cut = settings.packageJson.lastIndexOf('/')
  const dir = cut < 0 ? '' : settings.packageJson.slice(0, cut + 1)
  const manager = settings.packageManager === 'auto' ? await detectManager($, dir) : settings.packageManager

  const failures: Failure[] = []
  for (const { check, script } of plan) {
    $.ui.status(`🧪 qa-gate: running ${script}…`)
    try {
      const ran = await $.process.run(scriptArgv(manager, script), {
        cwd: dir === '' ? undefined : dir,
        env: { CI: 'true', FORCE_COLOR: '0' },
        timeoutMs: settings.timeoutMs,
      })
      if (ran.exitCode !== 0) {
        failures.push({ check, script, exitCode: ran.exitCode, output: `${ran.stdout}\n${ran.stderr}` })
      }
    } catch (error) {
      failures.push({ check, script, exitCode: -1, output: error instanceof Error ? error.message : String(error) })
    }
  }

  const passed = plan.length - failures.length
  $.ui.status(failures.length === 0 ? `✅ qa-gate: ${passed}/${plan.length} passed` : `❌ qa-gate: ${failures.map(f => f.script).join(', ')} failed`)
  return failures.length === 0 ? undefined : failureMessage(failures, script => scriptArgv(manager, script).join(' '))
}

export const register: Register = (on, options) => {
  on('tool.call', { tool: ['Write', 'Edit', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.tool === 'Write' || e.tool === 'Edit' ? e.file_path : ''
    const settings = await load($, options)
    if (settings.codeExtensions.some(ext => path.toLowerCase().endsWith(ext))) isDirty = true
    return ran
  })

  on('classic.Stop', async ($, e, next) => {
    const settings = await load($, options)
    if (!settings.enabled || !isDirty) return next(e)

    const problems = await runGate($, settings)
    if (problems === undefined) {
      isDirty = false
      attempts = 0
      return next(e)
    }
    attempts += 1
    if (attempts > settings.maxAttempts) {
      $.ui.toast(`qa-gate: still failing after ${settings.maxAttempts} tries; letting the turn end`)
      // Start over on the next code change rather than holding every later turn.
      isDirty = false
      attempts = 0
      return next(e)
    }
    return { block: problems }
  })
}
