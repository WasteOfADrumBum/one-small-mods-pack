import type { EngineInterface, PluginOptions, Register } from 'claude-code'

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

let warnedMissingTokens = false

/** The project's tokens, or undefined when the tokens file is missing or unreadable. */
async function readTokens($: EngineInterface, path: string): Promise<Token[] | undefined> {
  if (!(await $.fs.exists(path))) {
    if (!warnedMissingTokens) {
      warnedMissingTokens = true
      $.ui.toast(`design-guardrail: no tokens file at ${path}; set tokensFile to turn the guard on`)
    }
    return undefined
  }
  try {
    return parseTokens(path, await $.fs.read(path))
  } catch (error) {
    $.ui.log(`could not read tokens from ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/** The file's current text, or '' when it does not exist yet. */
async function currentText($: EngineInterface, path: string): Promise<string> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : ''
}

export const register: Register = (on, options) => {
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    if (e.tool !== 'Write' && e.tool !== 'Edit') return next(e)
    const settings = await load($, options)
    if (!settings.enabled) return next(e)

    const path = normalizePath(e.file_path)
    const lower = path.toLowerCase()
    if (!settings.extensions.some(ext => lower.endsWith(ext))) return next(e)
    if (settings.ignore.some(glob => globToRegExp(glob).test(path))) return next(e)
    if (path.endsWith(normalizePath(settings.tokensFile).replace(/^\.\//, ''))) return next(e)

    const tokens = await readTokens($, settings.tokensFile)
    if (tokens === undefined) return next(e)

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

    const violations = newViolations(
      findViolations(added, path, settings.allow),
      findViolations(before, path, settings.allow),
    )
    if (violations.length === 0) return next(e)

    const shown = violations.slice(0, settings.maxReported)
    const more = violations.length - shown.length
    $.ui.status(`🎨 design-guardrail blocked ${violations.length} hardcoded value${violations.length === 1 ? '' : 's'}`)
    return {
      deny: [
        `design-guardrail: this ${e.tool} to ${e.file_path} hardcodes ${violations.length} value${violations.length === 1 ? '' : 's'} that should be design tokens (from ${settings.tokensFile}):`,
        ...shown.map(v => explain(v, tokens, lineOffset)),
        ...(more > 0 ? [`- …and ${more} more.`] : []),
        'Replace each with the token named and retry. A value that truly must stay can be kept with a `guardrail-ignore` comment on its line.',
      ].join('\n'),
    }
  })
}
