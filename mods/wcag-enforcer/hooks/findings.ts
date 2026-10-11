// The checks' outputs, read into one shape and written up for Claude.
import type { ContrastIssue } from './contrast'

export type Finding = {
  line: number | undefined
  column?: number
  /** The rule that failed: `jsx-a11y/alt-text`, `axe/image-alt`, `wcag/contrast-minimum`. */
  rule: string
  message: string
}

export type ToolFailure = { tool: 'eslint' | 'axe'; reason: string }

type EslintMessage = { ruleId?: string | null; line?: number; column?: number; message?: string; severity?: number }
type EslintResult = { filePath?: string; messages?: EslintMessage[] }

/** Reads `eslint --format json` output, keeping the rules under the accessibility prefixes. */
export function parseEslint(stdout: string, prefixes: readonly string[]): Finding[] | ToolFailure {
  let results: unknown
  try {
    results = JSON.parse(stdout)
  } catch {
    return { tool: 'eslint', reason: 'eslint did not print JSON (is ESLint installed in this project?)' }
  }
  if (!Array.isArray(results)) return { tool: 'eslint', reason: 'unexpected ESLint output' }
  return (results as EslintResult[]).flatMap(result =>
    (result.messages ?? [])
      .filter(m => typeof m.ruleId === 'string' && prefixes.some(p => m.ruleId!.startsWith(p)))
      .map(m => ({ line: m.line, column: m.column, rule: m.ruleId!, message: m.message ?? '' })),
  )
}

/** Whether the project's resolved ESLint config (`eslint --print-config`) turns on any accessibility rule. */
export function hasA11yRules(printedConfig: string, prefixes: readonly string[]): boolean {
  try {
    const config = JSON.parse(printedConfig) as { rules?: Record<string, unknown> }
    return Object.entries(config.rules ?? {}).some(([rule, setting]) => {
      const level = Array.isArray(setting) ? setting[0] : setting
      return prefixes.some(p => rule.startsWith(p)) && level !== 'off' && level !== 0
    })
  } catch {
    return false
  }
}

type AxeNode = { rule?: string; impact?: string; help?: string; helpUrl?: string; line?: number; target?: string }

/** Reads what scripts/axe-check.mjs printed. */
export function parseAxe(stdout: string): Finding[] | ToolFailure {
  let parsed: { violations?: AxeNode[]; error?: string; message?: string }
  try {
    parsed = JSON.parse(stdout.trim().split('\n').at(-1) ?? '')
  } catch {
    return { tool: 'axe', reason: 'the axe check did not print JSON' }
  }
  if (parsed.error !== undefined) {
    return {
      tool: 'axe',
      reason:
        parsed.error === 'missing-deps'
          ? 'axe-core and jsdom are not installed in this project (npm i -D axe-core jsdom)'
          : `the axe check failed: ${parsed.message ?? parsed.error}`,
    }
  }
  return (parsed.violations ?? []).map(v => ({
    line: v.line,
    rule: `axe/${v.rule ?? 'unknown'}`,
    message: `${v.help ?? ''}${v.target ? ` (at ${v.target})` : ''}${v.impact ? ` [${v.impact}]` : ''}`.trim(),
  }))
}

export function contrastFindings(issues: readonly ContrastIssue[]): Finding[] {
  return issues.map(issue => ({
    line: issue.line,
    rule: 'wcag/contrast-minimum',
    message:
      `text ${issue.foreground} on ${issue.background} has contrast ${issue.ratio}:1; ` +
      `WCAG 2.2 AA (1.4.3) needs ${issue.required}:1${issue.isLargeText ? ' for large text' : ''}`,
  }))
}

/** The note Claude reads after its edit: one line per failure, file, line and rule. */
export function report(file: string, findings: readonly Finding[], limit = 30): string {
  const sorted = [...findings].sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
  const lines = sorted.slice(0, limit).map(f => {
    const where = f.line === undefined ? file : `${file}:${f.line}${f.column === undefined ? '' : `:${f.column}`}`
    return `- ${where} [${f.rule}] ${f.message}`
  })
  const more = sorted.length - lines.length
  return [
    `wcag-enforcer: ${findings.length} accessibility failure${findings.length === 1 ? '' : 's'} (WCAG 2.2 AA) in ${file}. Fix every one before moving on:`,
    ...lines,
    ...(more > 0 ? [`- …and ${more} more.`] : []),
  ].join('\n')
}
