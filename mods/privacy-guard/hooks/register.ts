import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { asBool, asList, asString, parseConfigText, pick } from './config'
import type { RawConfig } from './config'
import { isConfigPath, publicContactsOf } from './config-guard'
import { findPrivacy, isFixturePath, maskValue, newHits } from './privacy'
import type { PrivacyHit, PrivacyOptions, PrivacySeverity } from './privacy'

type Settings = {
  enabled: boolean
  mode: 'block' | 'warn'
  blockAt: PrivacySeverity
  noteAt: PrivacySeverity
  publicContacts: string[]
  allowDomains: string[]
  ignore: string[]
}

const DEFAULT_CONFIG = '.claude/guardrail-mods/privacy-guard.json'

const ORDER: PrivacySeverity[] = ['critical', 'high', 'medium', 'low', 'info']
const atLeast = (severity: PrivacySeverity, threshold: PrivacySeverity) => ORDER.indexOf(severity) <= ORDER.indexOf(threshold)
const asSeverity = (value: unknown): PrivacySeverity | undefined =>
  typeof value === 'string' && (ORDER as string[]).includes(value) ? (value as PrivacySeverity) : undefined

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
  const configFile = asString(options.configFile) ?? DEFAULT_CONFIG
  const file = await readConfigFile($, configFile)
  const mode = pick(file, options, 'mode', 'block', asString)
  return {
    enabled: pick(file, options, 'enabled', true, asBool),
    mode: mode === 'warn' ? 'warn' : 'block',
    blockAt: pick(file, options, 'blockAt', 'high', asSeverity),
    noteAt: pick(file, options, 'noteAt', 'medium', asSeverity),
    publicContacts: pick(file, options, 'publicContacts', [] as string[], asList),
    allowDomains: pick(file, options, 'allowDomains', [] as string[], asList),
    ignore: pick(file, options, 'ignore', [] as string[], asList),
  }
}

/**
 * What a write to the guard's own config adds. Contact details listed under a well-formed top-level
 * `publicContacts` array are public by that very list, so they are not held against the write; the same
 * values anywhere else in the file, and every other kind of value, are judged as usual.
 */
function scanConfig(text: string, scan: PrivacyOptions): PrivacyHit[] {
  const hits = findPrivacy(text, scan)
  const listed = publicContactsOf(text)
  if (listed === undefined || listed.entries.length === 0) return hits
  const key = (hit: PrivacyHit) => `${hit.line}:${hit.kind}:${hit.value}`
  const stillFlagged = new Set(findPrivacy(text, { ...scan, publicContacts: [...(scan.publicContacts ?? []), ...listed.entries] }).map(key))
  return hits.filter(hit => stillFlagged.has(key(hit)) || hit.line < listed.firstLine || hit.line > listed.lastLine)
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

const describe = (hit: PrivacyHit, lineOffset: number) =>
  `- line ${hit.line + lineOffset}: ${hit.category.toUpperCase()} ${hit.kind} ${maskValue(hit)}, ${hit.severity} (${hit.reason})`

export const register: Register = (on, options) => {
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    if (e.tool !== 'Write' && e.tool !== 'Edit') return next(e)
    // Tool arguments arrive as JSON from the model: use only what really is a string. A call without a
    // string path cannot write a file; the tool rejects it itself, so it passes through unchanged.
    const filePath = asString(e.file_path)
    if (filePath === undefined) return next(e)
    const settings = await load($, options)
    const path = filePath.replace(/\\/g, '/')
    if (!settings.enabled || settings.ignore.some(glob => globToRegExp(glob).test(path))) return next(e)

    const scan = { publicContacts: settings.publicContacts, allowDomains: settings.allowDomains, isFixture: isFixturePath(path) }
    const isConfig = isConfigPath(path, asString(options.configFile) ?? DEFAULT_CONFIG)
    let lineOffset = 0
    let hits: PrivacyHit[]
    const existing = (await $.fs.exists(filePath)) ? await $.fs.read(filePath) : ''
    if (e.tool === 'Write') {
      const content = asString(e.content) ?? ''
      hits = isConfig ? newHits(scanConfig(content, scan), scanConfig(existing, scan)) : newHits(findPrivacy(content, scan), findPrivacy(existing, scan))
    } else {
      const oldText = asString(e.old_string) ?? ''
      const newText = asString(e.new_string) ?? ''
      const at = existing.indexOf(oldText)
      if (isConfig && oldText !== '' && at >= 0) {
        // The file as it will be: judge the whole config, so its publicContacts list can be read.
        const after = existing.slice(0, at) + newText + existing.slice(at + oldText.length)
        hits = newHits(scanConfig(after, scan), scanConfig(existing, scan))
      } else {
        if (at >= 0) lineOffset = existing.slice(0, at).split('\n').length - 1
        hits = newHits(findPrivacy(newText, scan), findPrivacy(oldText, scan))
      }
    }
    hits = hits.filter(hit => !hit.synthetic)

    const blocking = settings.mode === 'block' ? hits.filter(hit => atLeast(hit.severity, settings.blockAt)) : []
    if (blocking.length > 0) {
      $.ui.status(`🛡️ privacy-guard blocked ${blocking.length} likely personal or health data value${blocking.length === 1 ? '' : 's'}`)
      return {
        deny: [
          `privacy-guard: this ${e.tool} to ${filePath} writes data that looks like real personal or health information:`,
          ...blocking.slice(0, 20).map(hit => describe(hit, lineOffset)),
          'Use clearly synthetic values instead (example.com addresses, 555-01xx phone numbers, published test card numbers, made-up ids), or load the data at runtime from a store meant for it.',
          'If a value is truly meant to be here (public contact details, a documented example), mark its line with a `privacy-ignore` comment or list it under publicContacts in .claude/guardrail-mods/privacy-guard.json.',
        ].join('\n'),
      }
    }

    const notes = hits.filter(hit => atLeast(hit.severity, settings.noteAt))
    const ran = await next(e)
    if (notes.length === 0 || ran.deny !== undefined) return ran
    $.ui.status(`🛡️ privacy-guard: ${notes.length} value${notes.length === 1 ? '' : 's'} to review in ${e.file_path}`)
    return {
      ...ran,
      context: [
        ...(ran.context ?? []),
        [
          `privacy-guard: ${e.file_path} now holds ${notes.length} value${notes.length === 1 ? '' : 's'} that may be personal data. Check each is synthetic or meant to be public:`,
          ...notes.slice(0, 20).map(hit => describe(hit, lineOffset)),
        ].join('\n'),
      ],
    }
  })
}
