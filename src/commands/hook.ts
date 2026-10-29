// modspack hook <platform>: the pre-write guard Codex, Copilot and Gemini CLI
// run before they write a file. It reads the tool call from stdin, checks the
// text being written for secrets, personal data and hardcoded design values,
// and answers in the platform's own deny format.
//
// It does not look at shell commands (a command's effect is not knowable
// from its text) and it does not rewrite tool output. `modspack security` and
// `modspack release-check` in CI are the enforced backstop. If the hook
// itself fails it lets the call through and says so on stderr.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { findViolations, explain } from '../../mods/design-guardrail/hooks/scan'
import { parseTokens } from '../../mods/design-guardrail/hooks/tokens'
import { findPrivacy, isFixturePath, maskValue } from '../../mods/privacy-guard/hooks/privacy'
import { secretHits } from '../checks/secrets'
import { loadConfig } from '../core/config'
import type { Platform } from '../core/config'
import { mask } from '../core/report'

export type HookDecision = { allow: true } | { allow: false; reason: string }

const SHELL_TOOL = /bash|shell|exec|terminal|command|run_in/i
const PATH_KEYS = ['file_path', 'filePath', 'path', 'file', 'target_file', 'filename']
const OLD_KEYS = /^(old|prev|original)/i
const SPECIFIC_SECRET = new Set(['private-key', 'aws-secret-access-key', 'github-token', 'google-api-key', 'google-oauth-token', 'google-client-secret', 'aws-access-key-id', 'vercel-token', 'slack-token', 'stripe-key', 'anthropic-key', 'openai-key'])
const PLACEHOLDER = /example|sample|dummy|fake|placeholder|changeme|x{6,}|\*{4,}|<[^>]+>|redacted|_test_/i
const UI_FILE = /\.(css|scss|sass|less|tsx|jsx|vue|html|svelte|astro)$/i

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function strings(value: unknown, out: string[], key = ''): void {
  if (typeof value === 'string') {
    if (!OLD_KEYS.test(key) && !PATH_KEYS.includes(key)) out.push(value)
  } else if (Array.isArray(value)) value.forEach(v => strings(v, out, key))
  else if (isRecord(value)) for (const [k, v] of Object.entries(value)) strings(v, out, k)
}

/** The tool call in a payload from any of the three platforms. */
export function readCall(payload: unknown): { tool: string; file: string | undefined; added: string } | undefined {
  if (!isRecord(payload)) return undefined
  const tool = String(payload.tool_name ?? payload.toolName ?? payload.tool ?? '')
  let input: unknown = payload.tool_input ?? payload.toolArgs ?? payload.tool_args ?? payload.args ?? {}
  if (typeof input === 'string') {
    try { input = JSON.parse(input) } catch { /* a bare string is the content itself */ }
  }
  if (SHELL_TOOL.test(tool)) return { tool, file: undefined, added: '' }
  const file = isRecord(input) ? PATH_KEYS.map(k => input && (input as Json)[k]).find((v): v is string => typeof v === 'string') : undefined
  const texts: string[] = []
  strings(input, texts)
  // apply_patch carries a unified-style patch: only the lines it adds are new.
  const added = /apply_patch|patch/i.test(tool)
    ? texts.flatMap(t => t.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1))).join('\n')
    : texts.join('\n')
  return { tool, file, added }
}

/** Decides whether the write may go ahead. Throws only on bugs; the caller lets those through. */
export function decide(payload: unknown, cwd: string): HookDecision {
  const call = readCall(payload)
  if (call === undefined || call.added.trim() === '') return { allow: true }
  const { config } = loadConfig(cwd)
  const file = call.file ?? ''
  const rel = file === '' ? '' : path.isAbsolute(file) ? path.relative(cwd, file) : file
  const problems: string[] = []

  if (config.guards.security) {
    for (const hit of secretHits(call.added)) {
      if (SPECIFIC_SECRET.has(hit.rule) && !PLACEHOLDER.test(hit.value)) problems.push(`a ${hit.rule} ${mask(hit.value)} (credential format). Load it from the environment instead and rotate it if it is real.`)
    }
  }
  if (config.guards.privacy) {
    for (const hit of findPrivacy(call.added, { publicContacts: config.privacy.publicContacts, allowDomains: config.privacy.allowDomains, isFixture: isFixturePath(rel) })) {
      if (!hit.synthetic && (hit.severity === 'high' || hit.severity === 'critical') && hit.confidence !== 'possible') problems.push(`${hit.category.toUpperCase()} ${hit.kind} ${maskValue(hit)}: ${hit.reason}. Use clearly synthetic values.`)
    }
  }
  if (config.guards.design && rel !== '' && UI_FILE.test(rel)) {
    const tokenFile = [config.design.tokensFile, 'design-tokens.json'].filter((f): f is string => f !== undefined).find(f => existsSync(path.join(cwd, f)))
    if (tokenFile !== undefined && !rel.endsWith(tokenFile)) {
      const tokens = parseTokens(tokenFile, readFileSync(path.join(cwd, tokenFile), 'utf8'))
      for (const v of findViolations(call.added, rel, { allow: config.design.allow })) problems.push(explain(v, tokens).replace(/^- /, 'design token: '))
    }
  }
  if (problems.length === 0) return { allow: true }
  return {
    allow: false,
    reason: [`ModsPack blocked this ${call.tool}${rel === '' ? '' : ` to ${rel}`}:`, ...problems.slice(0, 10).map(p => `- ${p}`), 'Fix these and retry. A value that must stay can be kept with a guardrail-ignore (design) or privacy-ignore (personal data) comment on its line.'].join('\n'),
  }
}

/** The platform's reply and exit code for a decision. */
export function reply(platform: Platform, decision: HookDecision): { stdout: string; stderr: string; code: number } {
  if (decision.allow) return { stdout: platform === 'gemini' ? '{}' : '', stderr: '', code: 0 }
  if (platform === 'codex') {
    return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } }), stderr: '', code: 0 }
  }
  if (platform === 'gemini') return { stdout: JSON.stringify({ decision: 'deny', reason: decision.reason }), stderr: '', code: 0 }
  // Copilot treats a non-zero exit from a preToolUse command hook as a denial.
  return { stdout: JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: decision.reason }), stderr: decision.reason, code: 2 }
}

export function runHook(platform: Platform, stdin: string, cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const payload: unknown = stdin.trim() === '' ? {} : JSON.parse(stdin)
    const root = isRecord(payload) && typeof payload.cwd === 'string' && existsSync(payload.cwd) ? payload.cwd : cwd
    return reply(platform, decide(payload, root))
  } catch (error) {
    return { stdout: platform === 'gemini' ? '{}' : '', stderr: `modspack hook: could not check this call, letting it through (${(error as Error).message})`, code: 0 }
  }
}
