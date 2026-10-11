import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { asBool, asList, asNumber, asString, parseConfigText, pick } from './config'
import type { RawConfig } from './config'
import { checkContrast } from './contrast'
import { contrastFindings, hasA11yRules, parseAxe, parseEslint, report } from './findings'
import type { Finding, ToolFailure } from './findings'

type Settings = {
  enabled: boolean
  extensions: string[]
  eslint: boolean
  eslintCommand: string[]
  eslintRulePrefixes: string[]
  axe: boolean
  nodeCommand: string
  contrast: boolean
  blockStop: boolean
  timeoutMs: number
}

const COMPONENT = /\.(tsx|jsx|vue)$/i
const HTML = /\.html?$/i

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
  const configFile = asString(options.configFile) ?? '.claude/guardrail-mods/wcag-enforcer.json'
  const file = await readConfigFile($, configFile)
  return {
    enabled: pick(file, options, 'enabled', true, asBool),
    extensions: pick(file, options, 'extensions', ['.tsx', '.jsx', '.html', '.vue', '.css'], asList).map(x => x.toLowerCase()),
    eslint: pick(file, options, 'eslint', true, asBool),
    eslintCommand: pick(file, options, 'eslintCommand', 'npx --no-install eslint', asString).split(/\s+/).filter(Boolean),
    eslintRulePrefixes: pick(file, options, 'eslintRulePrefixes', ['jsx-a11y/', 'vuejs-accessibility/'], asList),
    axe: pick(file, options, 'axe', true, asBool),
    nodeCommand: pick(file, options, 'nodeCommand', 'node', asString),
    contrast: pick(file, options, 'contrast', true, asBool),
    blockStop: pick(file, options, 'blockStopUntilFixed', true, asBool),
    timeoutMs: pick(file, options, 'timeoutMs', 60_000, asNumber),
  }
}

// Each tool's problem is said once a session, not after every edit.
const warned = new Set<string>()
// Whether the project's ESLint config turns on accessibility rules, by command.
const eslintReady = new Map<string, boolean>()

function warnOnce($: EngineInterface, failure: ToolFailure) {
  if (warned.has(failure.tool)) return
  warned.add(failure.tool)
  $.ui.toast(`wcag-enforcer: skipping ${failure.tool} checks: ${failure.reason}`)
}

async function runEslint($: EngineInterface, settings: Settings, file: string): Promise<Finding[]> {
  const [command = 'npx', ...args] = settings.eslintCommand
  const key = settings.eslintCommand.join(' ')
  if (!eslintReady.has(key)) {
    const printed = await $.process.run([command, ...args, '--print-config', file], { timeoutMs: settings.timeoutMs })
    const ready = printed.exitCode === 0 && hasA11yRules(printed.stdout, settings.eslintRulePrefixes)
    eslintReady.set(key, ready)
    if (!ready) {
      warnOnce($, {
        tool: 'eslint',
        reason:
          printed.exitCode === 0
            ? `the project's ESLint config turns on no ${settings.eslintRulePrefixes.join(' or ')} rules (add eslint-plugin-jsx-a11y)`
            : `ESLint did not run (${printed.stderr.trim().split('\n')[0] ?? `exit ${printed.exitCode}`})`,
      })
    }
  }
  if (eslintReady.get(key) !== true) return []

  const ran = await $.process.run([command, ...args, '--format', 'json', file], { timeoutMs: settings.timeoutMs })
  const parsed = parseEslint(ran.stdout, settings.eslintRulePrefixes)
  if (!Array.isArray(parsed)) {
    warnOnce($, parsed)
    return []
  }
  return parsed
}

async function runAxe($: EngineInterface, settings: Settings, file: string): Promise<Finding[]> {
  const ran = await $.process.run([settings.nodeCommand, `${$.plugin.root}/scripts/axe-check.mjs`, file], {
    timeoutMs: settings.timeoutMs,
  })
  const parsed = parseAxe(ran.stdout)
  if (!Array.isArray(parsed)) {
    warnOnce($, parsed)
    return []
  }
  return parsed
}

/** Every accessibility failure the checks find in the file as it is now. */
async function check($: EngineInterface, settings: Settings, file: string): Promise<Finding[]> {
  const findings: Finding[] = []
  if (settings.eslint && COMPONENT.test(file)) {
    try {
      findings.push(...(await runEslint($, settings, file)))
    } catch (error) {
      warnOnce($, { tool: 'eslint', reason: `ESLint could not start (${error instanceof Error ? error.message : String(error)})` })
    }
  }
  if (settings.axe && HTML.test(file)) {
    try {
      findings.push(...(await runAxe($, settings, file)))
    } catch (error) {
      warnOnce($, { tool: 'axe', reason: `the axe check could not start (${error instanceof Error ? error.message : String(error)})` })
    }
  }
  if (settings.contrast) findings.push(...contrastFindings(checkContrast(await $.fs.read(file))))
  return findings
}

const shortName = (file: string) => file.split(/[\\/]/).at(-1) ?? file

// The failures each file had at its last check; a file is dropped once clean.
const outstanding = new Map<string, Finding[]>()
let stopBlocks = 0

function showStatus($: EngineInterface) {
  const count = [...outstanding.values()].reduce((sum, list) => sum + list.length, 0)
  const files = outstanding.size
  $.ui.status(count === 0 ? undefined : `♿ ${count} WCAG failure${count === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`)
}

export const register: Register = (on, options) => {
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'Write' && e.tool !== 'Edit') return ran
    if (ran.deny !== undefined || ran.isError === true) return ran

    const settings = await load($, options)
    const lower = e.file_path.toLowerCase()
    if (!settings.enabled || !settings.extensions.some(ext => lower.endsWith(ext))) return ran

    const findings = await check($, settings, e.file_path)
    if (findings.length === 0) {
      outstanding.delete(e.file_path)
      showStatus($)
      return ran
    }
    outstanding.set(e.file_path, findings)
    stopBlocks = 0
    showStatus($)
    return { ...ran, context: [...(ran.context ?? []), report(e.file_path, findings)] }
  })

  on('classic.Stop', async ($, e, next) => {
    const settings = await load($, options)
    if (!settings.enabled || !settings.blockStop || outstanding.size === 0) return next(e)
    // Never hold the turn forever: two reminders, then let it end.
    if (stopBlocks >= 2) {
      $.ui.toast(`wcag-enforcer: ending the turn with accessibility failures left in ${[...outstanding.keys()].map(shortName).join(', ')}`)
      stopBlocks = 0
      return next(e)
    }
    stopBlocks += 1
    return {
      block: [
        'wcag-enforcer: these accessibility failures are still open. Fix them, then finish:',
        ...[...outstanding.entries()].map(([file, findings]) => report(file, findings, 10)),
      ].join('\n\n'),
    }
  })
}
