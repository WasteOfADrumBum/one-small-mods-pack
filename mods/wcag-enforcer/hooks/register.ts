import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { bashWrites, changedFiles, porcelainPaths } from './bash-writes'
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
  watchBash: boolean
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
    watchBash: pick(file, options, 'watchBash', true, asBool),
    timeoutMs: pick(file, options, 'timeoutMs', 60_000, asNumber),
  }
}

// Each tool's problem is said once a session, not after every edit.
const warned = new Set<string>()
// Whether the project's ESLint config turns on accessibility rules, by command.
const eslintReady = new Map<string, boolean>()

// The checks that could not run, by tool, with why: shown in the status
// line for as long as it holds, so a skipped check never reads as a pass.
const skipped = new Map<ToolFailure['tool'], string>()

function warnOnce($: EngineInterface, failure: ToolFailure) {
  skipped.set(failure.tool, failure.reason)
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
  skipped.delete('eslint')
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
  skipped.delete('axe')
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
  const parts: string[] = []
  if (count > 0) parts.push(`${count} WCAG failure${count === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`)
  if (skipped.size > 0) parts.push(`${[...skipped.keys()].join(' and ')} not running`)
  $.ui.status(parts.length === 0 ? undefined : `♿ ${parts.join(' · ')}`)
}

/** Checks a file, records what it found, and returns the note for Claude when something failed. */
async function checkFile($: EngineInterface, settings: Settings, file: string): Promise<string | undefined> {
  const findings = await check($, settings, file)
  if (findings.length === 0) outstanding.delete(file)
  else {
    outstanding.set(file, findings)
    stopBlocks = 0
  }
  showStatus($)
  if (findings.length === 0) return undefined
  const notRun = [...skipped].map(([tool, reason]) => `(${tool} did not run: ${reason}.)`)
  return [report(file, findings), ...notRun].join('\n')
}

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

export const register: Register = (on, options) => {
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'Write' && e.tool !== 'Edit') return ran
    if (ran.deny !== undefined || ran.isError === true) return ran

    // Tool arguments arrive as JSON from the model: a call without a string path wrote no file to check.
    const filePath = asString(e.file_path)
    if (filePath === undefined) return ran
    const settings = await load($, options)
    const lower = filePath.toLowerCase()
    if (!settings.enabled || !settings.extensions.some(ext => lower.endsWith(ext))) return ran

    const note = await checkFile($, settings, filePath)
    return note === undefined ? ran : { ...ran, context: [...(ran.context ?? []), note] }
  })

  // A UI file written through the shell skips the Write/Edit hook above:
  // check what the command names as written, and what git shows it changed.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const settings = await load($, options)
    if (!settings.enabled || !settings.watchBash) return next(e)
    const checked = (path: string) => settings.extensions.some(ext => path.toLowerCase().endsWith(ext))

    const before = await dirtyFiles($, checked)
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const after = before === undefined ? undefined : await dirtyFiles($, checked)

    const files = new Set(before !== undefined && after !== undefined ? changedFiles(before, after) : [])
    const command = asString(e.command)
    for (const write of command === undefined ? [] : bashWrites(command)) {
      if (!checked(write.path) || !(await $.fs.exists(write.path))) continue
      const stat = await $.fs.stat(write.path, { resolve: true }).catch(() => undefined)
      files.add(stat?.realPath ?? write.path)
    }

    const notes: string[] = []
    for (const file of files) {
      const note = await checkFile($, settings, file)
      if (note !== undefined) notes.push(note)
    }
    return notes.length === 0 ? ran : { ...ran, context: [...(ran.context ?? []), ...notes] }
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
