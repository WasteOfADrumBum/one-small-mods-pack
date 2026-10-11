import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { asBool, asList, asString, parseConfigText, pick } from './config'
import type { RawConfig } from './config'
import { BUILTIN_RULES, scrub, userRules } from './patterns'
import type { SecretRule } from './patterns'

type Block = { type: string; [field: string]: unknown }

type Settings = {
  enabled: boolean
  showToast: boolean
  rules: SecretRule[]
}

// A .env file, but not the checked-in examples beside it.
const ENV_FILE = /(^|[\\/])\.env(\.(?!example\b|sample\b|template\b|dist\b)[\w-]+)?$/
const ENV_IN_COMMAND = /(^|[\s'"=\\/])\.env(\.(?!example\b|sample\b|template\b|dist\b)[\w-]+)?(?=$|[\s'";|&)])/

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
  const configFile = asString(options.configFile) ?? '.claude/guardrail-mods/secret-scrubber.json'
  const file = await readConfigFile($, configFile)
  const log = (message: string) => $.ui.log(message)

  const disabled = new Set(pick(file, options, 'disabledRules', [] as string[], asList))
  const rules = BUILTIN_RULES.filter(rule => !disabled.has(rule.name))
  rules.push(...userRules(file.patterns, log))

  const patternsFile = pick(file, options, 'patternsFile', '', asString)
  if (patternsFile !== '') {
    const extra = await readConfigFile($, patternsFile)
    rules.push(...userRules(extra.patterns, log))
  }

  return {
    enabled: pick(file, options, 'enabled', true, asBool),
    showToast: pick(file, options, 'showToast', true, asBool),
    rules,
  }
}

/** Scrubs a tool_result block's text, whether its content is a string or blocks. */
function scrubBlock(block: Block, rules: readonly SecretRule[], isEnv: boolean) {
  let count = 0
  const kinds: string[] = []
  const take = (text: string) => {
    const done = scrub(text, rules, isEnv)
    count += done.count
    kinds.push(...done.kinds)
    return done.text
  }

  if (block.type === 'text' && typeof block.text === 'string') {
    return { block: { ...block, text: take(block.text) }, count, kinds }
  }
  if (block.type !== 'tool_result') return { block, count, kinds }

  const { content } = block
  if (typeof content === 'string') return { block: { ...block, content: take(content) }, count, kinds }
  if (Array.isArray(content)) {
    const next = content.map((inner: unknown) => {
      const item = inner as Block
      return item.type === 'text' && typeof item.text === 'string' ? { ...item, text: take(item.text) } : item
    })
    return { block: { ...block, content: next }, count, kinds }
  }
  return { block, count, kinds }
}

export const register: Register = (on, options) => {
  // Tool calls whose output is the text of a .env file, by tool_use_id
  const envCalls = new Set<string>()
  let total = 0

  on('tool.call', ($, e, next) => {
    const isEnv =
      (e.tool === 'Read' && ENV_FILE.test(e.file_path)) ||
      (e.tool === 'Bash' && ENV_IN_COMMAND.test(e.command))
    if (isEnv) envCalls.add(e.tool_use_id)
    return next(e)
  })

  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    const settings = await load($, options)
    if (!settings.enabled) return next(e)

    let count = 0
    const kinds = new Set<string>()
    const content = e.message.content.map(raw => {
      const block = raw as Block
      const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
      const done = scrubBlock(block, settings.rules, envCalls.has(id))
      envCalls.delete(id)
      count += done.count
      for (const kind of done.kinds) kinds.add(kind)
      return done.block
    })
    if (count === 0) return next(e)

    total += count
    $.ui.status(`🔒 ${total} secret${total === 1 ? '' : 's'} redacted`)
    if (settings.showToast) {
      const tool = e.origin.kind === 'tool' ? e.origin.tool : 'tool'
      $.ui.toast(`secret-scrubber: redacted ${count} from ${tool} output (${[...kinds].join(', ')})`)
    }
    return next({ ...e, message: { ...e.message, content } })
  }).catch(($, e, next) => {
    // Fail closed: if the scan itself failed, Claude reads no output at all.
    if (next.called) return next(e)
    const content = e.message.content.map(raw => {
      const block = raw as Block
      return block.type === 'tool_result'
        ? { ...block, content: '[secret-scrubber could not scan this output, so it was withheld]' }
        : block
    })
    return next({ ...e, message: { ...e.message, content } })
  })
}
