import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { bashWrites, changedFiles, porcelainPaths } from './bash-writes'
import { asBool, asList, asNumber, asString, parseConfigText, pick } from './config'
import type { RawConfig } from './config'
import { explain, findViolations, newViolations } from './scan'
import { parseTokens } from './tokens'
import type { Token } from './tokens'

type Settings = {
  enabled: boolean
  tokensFile: string
  extensions: string[]
  ignore: string[]
  allow: string[]
  maxReported: number
  allowSvgColors: boolean
  blockBashWrites: boolean
  watchBash: boolean
}

const DEFAULT_EXTENSIONS = ['.css', '.scss', '.sass', '.less', '.tsx', '.jsx', '.vue', '.html', '.svelte', '.astro']

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
  const configFile = asString(options.configFile) ?? '.claude/guardrail-mods/design-guardrail.json'
  const file = await readConfigFile($, configFile)
  return {
    enabled: pick(file, options, 'enabled', true, asBool),
    tokensFile: pick(file, options, 'tokensFile', 'design-tokens.json', asString),
    extensions: pick(file, options, 'extensions', DEFAULT_EXTENSIONS, asList).map(x => x.toLowerCase()),
    ignore: pick(file, options, 'ignore', [] as string[], asList),
    allow: pick(file, options, 'allow', ['0', '0px'], asList),
    maxReported: pick(file, options, 'maxReported', 20, asNumber),
    allowSvgColors: pick(file, options, 'allowSvgColors', true, asBool),
    blockBashWrites: pick(file, options, 'blockBashWrites', true, asBool),
    watchBash: pick(file, options, 'watchBash', true, asBool),
  }
}

/** A simple glob (`*`, `**`) as a regular expression over a path. */
const globToRegExp = (glob: string) =>
  new RegExp(
    '(^|/)' +
      glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\/?/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*') +
      '$',
  )

const normalizePath = (path: string) => path.replace(/\\/g, '/')

/** Whether the guard looks at this path at all. */
function isGuarded(settings: Settings, file: string): boolean {
  const path = normalizePath(file)
  const lower = path.toLowerCase()
  if (!settings.extensions.some(ext => lower.endsWith(ext))) return false
  if (settings.ignore.some(glob => globToRegExp(glob).test(path))) return false
  return !path.endsWith(normalizePath(settings.tokensFile).replace(/^\.\//, ''))
}

let warnedMissingTokens = false

/** The project's tokens, or undefined when the tokens file is missing or unreadable. */
async function readTokens($: EngineInterface, path: string): Promise<Token[] | undefined> {
  if (!(await $.fs.exists(path))) {
    // Said in the status line for as long as it holds, so an idle guard never passes for a clean one.
    $.ui.status(`🎨 design-guardrail idle: no tokens file at ${path}`)
    if (!warnedMissingTokens) {
      warnedMissingTokens = true
      $.ui.toast(`design-guardrail: no tokens file at ${path}; set tokensFile to turn the guard on`)
    }
    return undefined
  }
  try {
    return parseTokens(path, await $.fs.read(path))
  } catch (error) {
    $.ui.status(`🎨 design-guardrail idle: ${path} could not be read`)
    $.ui.log(`could not read tokens from ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/** The file's current text, or '' when it does not exist yet. */
async function currentText($: EngineInterface, path: string): Promise<string> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : ''
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

/** The file as last committed, or '' when it is new; values already there are not the edit's doing. */
async function committedText($: EngineInterface, path: string): Promise<string> {
  if (gitRoot === undefined || gitRoot === null || !path.startsWith(gitRoot + '/')) return ''
  const shown = await $.process.run(['git', 'show', `HEAD:${path.slice(gitRoot.length + 1)}`], { timeoutMs: 10_000 }).catch(() => undefined)
  return shown !== undefined && shown.exitCode === 0 ? shown.stdout : ''
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const register: Register = (on, options) => {
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    if (e.tool !== 'Write' && e.tool !== 'Edit') return next(e)
    const settings = await load($, options)
    if (!settings.enabled || !isGuarded(settings, e.file_path)) return next(e)

    const tokens = await readTokens($, settings.tokensFile)
    if (tokens === undefined) return next(e)

    const path = normalizePath(e.file_path)
    const existing = await currentText($, e.file_path)
    let added: string
    let before: string
    let lineOffset = 0
    if (e.tool === 'Write') {
      added = e.content
      before = existing
    } else {
      added = e.new_string
      before = e.old_string
      const at = existing.indexOf(e.old_string)
      if (at >= 0) lineOffset = existing.slice(0, at).split('\n').length - 1
    }

    const scan = { allow: settings.allow, allowSvgColors: settings.allowSvgColors }
    const violations = newViolations(findViolations(added, path, scan), findViolations(before, path, scan))
    if (violations.length === 0) {
      $.ui.status(undefined)
      return next(e)
    }

    const shown = violations.slice(0, settings.maxReported)
    const more = violations.length - shown.length
    $.ui.status(`🎨 design-guardrail blocked ${plural(violations.length, 'hardcoded value')}`)
    return {
      deny: [
        `design-guardrail: this ${e.tool} to ${e.file_path} hardcodes ${plural(violations.length, 'value')} that should be design tokens (from ${settings.tokensFile}):`,
        ...shown.map(v => explain(v, tokens, lineOffset)),
        ...(more > 0 ? [`- …and ${more} more.`] : []),
        'Replace each with the token named and retry. A value that truly must stay can be kept with a `guardrail-ignore` comment on its line.',
      ].join('\n'),
    }
  })

  // A UI file written through the shell skips the Write/Edit guard above:
  // refuse the commands that plainly write one, and check what any other
  // command changed once it has run.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const settings = await load($, options)
    if (!settings.enabled) return next(e)

    const named = bashWrites(e.command).filter(w => isGuarded(settings, w.path))
    const writing = named.filter(w => w.via !== 'copy')
    if (settings.blockBashWrites && writing.length > 0) {
      $.ui.status('🎨 design-guardrail blocked a shell write to a UI file')
      return {
        deny:
          `design-guardrail: this command writes ${writing.map(w => w.path).join(', ')} from the shell, which skips the design token check. ` +
          'Make the change with the Write or Edit tool instead.',
      }
    }
    if (!settings.watchBash) return next(e)

    const tokens = await readTokens($, settings.tokensFile)
    if (tokens === undefined) return next(e)

    const guarded = (rel: string) => isGuarded(settings, rel)
    const before = await dirtyFiles($, guarded)
    const ran = await next(e)
    if (ran.deny !== undefined || before === undefined) return ran
    const after = await dirtyFiles($, guarded)
    if (after === undefined) return ran

    const notes: string[] = []
    for (const path of changedFiles(before, after)) {
      const scan = { allow: settings.allow, allowSvgColors: settings.allowSvgColors }
      const violations = newViolations(
        findViolations(await $.fs.read(path), path, scan),
        findViolations(await committedText($, path), path, scan),
      )
      if (violations.length === 0) continue
      notes.push(
        [
          `design-guardrail: that command changed ${path}, which now hardcodes ${plural(violations.length, 'value')} that should be design tokens (from ${settings.tokensFile}). Fix them with the Edit tool:`,
          ...violations.slice(0, settings.maxReported).map(v => explain(v, tokens)),
        ].join('\n'),
      )
    }
    if (notes.length === 0) return ran
    $.ui.status(`🎨 design-guardrail: a shell command left hardcoded values in ${plural(notes.length, 'file')}`)
    return { ...ran, context: [...(ran.context ?? []), ...notes] }
  })
}
