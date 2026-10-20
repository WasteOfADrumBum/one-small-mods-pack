// Committed secrets: the working tree, build output and git history, with
// secret-scrubber's own rules (imported, not copied), so Claude's redaction
// and CI's detection agree on what a secret is.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { BUILTIN_RULES } from '../../mods/secret-scrubber/hooks/patterns'
import type { SecretRule } from '../../mods/secret-scrubber/hooks/patterns'
import { isFixturePath } from '../../mods/privacy-guard/hooks/privacy'
import { lineOf } from '../core/files'
import { mask } from '../core/report'
import type { Confidence, Finding, Severity } from '../core/report'

// Formats specific enough that a match is an exposed credential, whether or not it is still live.
const SEVERITY: Record<string, Severity> = {
  'private-key': 'critical',
  'aws-secret-access-key': 'critical',
  'github-token': 'high',
  'google-api-key': 'high',
  'google-oauth-token': 'high',
  'google-client-secret': 'high',
  'aws-access-key-id': 'high',
  'vercel-token': 'high',
  'todoist-token': 'high',
  'slack-token': 'high',
  'stripe-key': 'high',
  'anthropic-key': 'high',
  'openai-key': 'high',
  'url-credentials': 'high',
  'bearer-token': 'medium',
  jwt: 'medium',
  'generic-secret': 'medium',
}
const SPECIFIC = new Set(['private-key', 'aws-secret-access-key', 'github-token', 'google-api-key', 'google-oauth-token', 'google-client-secret', 'aws-access-key-id', 'vercel-token', 'slack-token', 'stripe-key', 'anthropic-key', 'openai-key'])

const STEP_DOWN: Record<Severity, Severity> = { critical: 'high', high: 'medium', medium: 'low', low: 'info', info: 'info' }

// Values that announce themselves as placeholders or documentation examples.
const SYNTHETIC = /example|sample|dummy|fake|placeholder|changeme|your[_-]?(?:api|secret|token|key)|x{6,}|\*{4,}|<[^>]+>|^test|_test_|testtest|0{12,}|1234567890abcdef|redacted/i

/** Shannon entropy in bits per character: random keys score high, words and paths low. */
export function entropy(value: string): number {
  const counts = new Map<string, number>()
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let bits = 0
  for (const n of counts.values()) bits -= (n / value.length) * Math.log2(n / value.length)
  return bits
}

// A generic key=value hit that is really code, a path or a URL, not a credential.
const NOT_A_CREDENTIAL = /\?\.|\?\?|^[\w$]+(?:\.[\w$]+)+[,;]?$|^[\w.-]*\/[\w./-]+\.\w{1,5}$|^https?:\/\/[^@]*$|^[A-Z_]+$/

export function fingerprint(rule: string, where: string, value: string): string {
  return createHash('sha256').update(`${rule}\0${where}\0${value}`).digest('hex').slice(0, 16)
}

type Hit = { rule: string; value: string; index: number }

/** Every secret-rule match in `text`, with the secret value (callers mask it). */
export function secretHits(text: string, rules: readonly SecretRule[] = BUILTIN_RULES): Hit[] {
  const hits: Hit[] = []
  for (const rule of rules) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g')
    for (const match of text.matchAll(pattern)) {
      const groups = match.slice(1)
      const value =
        rule.group === -1 ? groups.slice(1, 4).find(g => g !== undefined) : rule.group ? groups[rule.group - 1] : match[0]
      if (value === undefined || value === '') continue
      if (rule.accept !== undefined && !rule.accept(value)) continue
      if (rule.name === 'generic-secret' && NOT_A_CREDENTIAL.test(value)) continue
      hits.push({ rule: rule.name, value, index: (match.index ?? 0) + match[0].indexOf(value) })
    }
  }
  // The same value can match two rules (a Stripe key as a generic secret): keep the most specific.
  const seen = new Map<string, Hit>()
  for (const hit of hits) {
    const key = `${hit.index}`
    const prior = seen.get(key)
    if (prior === undefined || (SPECIFIC.has(hit.rule) && !SPECIFIC.has(prior.rule))) seen.set(key, hit)
  }
  return [...seen.values()].sort((a, b) => a.index - b.index)
}

/** Findings for one file's text. `where` is the path, or `<commit>:<path>` for history. */
export function secretFindings(text: string, where: string, category = 'secrets'): Finding[] {
  const filePath = where.includes(':') ? where.slice(where.indexOf(':') + 1) : where
  const fixture = isFixturePath(filePath)
  return secretHits(text).map(hit => {
    const synthetic = SYNTHETIC.test(hit.value) || /\b(sk|rk)_test_/.test(hit.value)
    let severity = SEVERITY[hit.rule] ?? 'medium'
    let confidence: Confidence = SPECIFIC.has(hit.rule) ? 'confirmed' : 'likely'
    let note = ''
    // A labelled value with little randomness is more often a word or an example than a key.
    if (hit.rule === 'generic-secret' && (hit.value.length < 12 || entropy(hit.value) < 3.5)) {
      confidence = 'possible'
      note = ' Its value has low randomness, so it may be a word or an example.'
    }
    if (synthetic) {
      severity = 'low'
      confidence = 'possible'
      note = ' It looks like a placeholder or test value.'
    } else if (fixture) {
      severity = STEP_DOWN[severity]
      confidence = 'likely'
      note = ' It is in test data: confirm it is synthetic.'
    }
    const line = lineOf(text, hit.index)
    const fp = fingerprint(hit.rule, filePath, hit.value)
    return {
      id: `SEC-${hit.rule}-${fp.slice(0, 8)}`,
      fingerprint: fp,
      category,
      rule: hit.rule,
      severity,
      confidence,
      path: where,
      line,
      evidence: `${hit.rule} ${mask(hit.value)}`,
      explanation: `A value matching the ${hit.rule} rule is committed.${note}`,
      remediation: confidence === 'possible' && !synthetic
        ? 'Check whether it is a real credential. If it is, rotate it and load it from the environment instead; if not, nothing to do (dismiss it in security.accepted to silence it).'
        : synthetic
        ? 'If it is a placeholder, make that obvious (EXAMPLE, xxxx) or assemble it from parts in tests; otherwise treat it as real.'
        : 'Treat it as compromised: rotate it with its provider, remove it from the code (load it from the environment or a secret store), and purge it from history if the repository is or was public.',
      validation: `Pattern match on line ${line}; liveness not checked (ModsPack never calls the provider).`,
      disposition: 'open',
    }
  })
}

export type HistoryScan = { findings: Finding[]; commits: number; shallow: boolean; error?: string }

/** Secrets added in the last `maxCommits` commits, by the lines each commit added. */
export function historyFindings(dir: string, maxCommits: number, excluded: (file: string) => boolean): HistoryScan {
  const git = (args: string[], maxBuffer = 16 * 1024 * 1024) =>
    execFileSync('git', args, { cwd: dir, maxBuffer, timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  let shallow = false
  try {
    shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true'
  } catch {
    return { findings: [], commits: 0, shallow: false, error: 'not a git repository' }
  }
  let log: string
  try {
    log = git(['log', '-p', '--no-color', '--no-ext-diff', '-U0', `-n${maxCommits}`, '--format=commit %H'], 512 * 1024 * 1024)
  } catch (error) {
    const message = (error as Error).message
    return { findings: [], commits: 0, shallow, error: /does not have any commits/.test(message) ? undefined : `git log failed: ${message.split('\n')[0]}` }
  }
  const findings: Finding[] = []
  let commit = ''
  let file = ''
  let added: string[] = []
  let commits = 0
  const flush = () => {
    if (commit !== '' && file !== '' && added.length > 0 && !excluded(file)) {
      findings.push(...secretFindings(added.join('\n'), `${commit.slice(0, 10)}:${file}`, 'secrets-history'))
    }
    added = []
  }
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) {
      flush()
      commit = line.slice(7).trim()
      file = ''
      commits += 1
    } else if (line.startsWith('+++ ')) {
      flush()
      file = line.startsWith('+++ b/') ? line.slice(6) : ''
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      added.push(line.slice(1))
    }
  }
  flush()
  // History lines carry no stable line numbers; drop them so findings read as "added in commit X".
  for (const finding of findings) finding.line = undefined
  return { findings, commits, shallow }
}

/** `.env` files that git tracks, which is where most committed secrets come from. */
export const ENV_FILE = /(^|\/)\.env(\.(?!example$|sample$|template$|dist$|defaults$)[\w.-]+)?$/

export function trackedEnvFindings(files: readonly string[]): Finding[] {
  return files.filter(f => ENV_FILE.test(f)).map(file => {
    const fp = fingerprint('tracked-env-file', file, file)
    return {
      id: `SEC-tracked-env-${fp.slice(0, 8)}`,
      fingerprint: fp,
      category: 'secrets',
      rule: 'tracked-env-file',
      severity: 'high',
      confidence: 'confirmed',
      path: file,
      evidence: `${path.basename(file)} is committed (values not shown)`,
      explanation: 'An environment file is in the repository. Every value in it should be treated as exposed.',
      remediation: 'Remove it from git (git rm --cached), add it to .gitignore, commit a .env.example with placeholder values, and rotate the real values.',
      validation: 'git ls-files lists it.',
      disposition: 'open',
    }
  })
}
