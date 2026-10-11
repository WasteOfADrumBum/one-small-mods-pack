// What counts as a secret, and how a text is scrubbed of them. Pure
// functions, so the tests exercise them without the engine.

export type SecretRule = {
  /** Shown in the placeholder: `[REDACTED:<name>]`. */
  name: string
  pattern: RegExp
  /**
   * The capture group holding the secret itself, when the match also holds a
   * label to keep (`password=` in `password=hunter2`); 0 (the default) is the
   * whole match.
   */
  group?: number
  /** Keeps a candidate value that is not a secret after all (code, a variable reference). */
  accept?: (value: string) => boolean
}

// A generic key=value hit is a secret only when the value looks like one: a
// literal with a digit or a long opaque run, never code (`getToken()`,
// `process.env.TOKEN`, `${token}`) or a type (`token: string`).
const looksLikeSecretValue = (value: string): boolean => {
  if (/[()${}<>]/.test(value)) return false
  if (/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+!?$/.test(value)) return false
  if (/^(?:true|false|null|undefined|none|string|number|boolean|required|optional|changeme|redacted|xxx+|\*+)$/i.test(value)) return false
  return /\d/.test(value) || value.length >= 20
}

// Names that mark the value beside them as a secret in key=value, key: value
// and "key": "value" forms, including .env lines and JSON.
const SECRET_NAME =
  String.raw`[A-Za-z0-9_.-]*(?:secret|passw(?:or)?d|pwd|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?key|credential|session[_-]?key|signing[_-]?key)[A-Za-z0-9_.-]*`

export const BUILTIN_RULES: readonly SecretRule[] = [
  {
    name: 'private-key',
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
  },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { name: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'google-oauth-token', pattern: /\bya29\.[0-9A-Za-z_-]{20,}/g },
  { name: 'google-client-secret', pattern: /\bGOCSPX-[0-9A-Za-z_-]{20,}/g },
  { name: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[0-9A-Z]{16}\b/g },
  {
    name: 'aws-secret-access-key',
    pattern: /(aws_?secret_?(?:access_?)?key["']?\s*[:=]\s*["']?)([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi,
    group: 2,
  },
  // Vercel tokens carry no fixed prefix in older formats, so they are caught
  // by their label (VERCEL_TOKEN=..., "vercelToken": "...") as well as the
  // newer vc*_ prefixes.
  { name: 'vercel-token', pattern: /\bvc[a-z]_[A-Za-z0-9]{24,}\b/g },
  {
    name: 'vercel-token',
    pattern: /(vercel[_-]?(?:api[_-]?)?(?:token|key)["']?\s*[:=]\s*["']?)([A-Za-z0-9_-]{20,})/gi,
    group: 2,
  },
  // Todoist API tokens are 40 hex characters with no prefix: caught by label.
  {
    name: 'todoist-token',
    pattern: /(todoist[_-]?(?:api[_-]?)?(?:token|key)["']?\s*[:=]\s*["']?)([0-9a-f]{40})\b/gi,
    group: 2,
  },
  { name: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: 'stripe-key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { name: 'bearer-token', pattern: /(\bBearer\s+)([A-Za-z0-9._~+/-]{20,}=*)/g, group: 2 },
  { name: 'url-credentials', pattern: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})(?=@)/gi, group: 2 },
  {
    name: 'generic-secret',
    pattern: new RegExp(
      String.raw`(["']?${SECRET_NAME}["']?\s*[:=]\s*)(?:"([^"\s]{6,})"|'([^'\s]{6,})'|([^\s"',;}{)\]]{6,}))`,
      'gi',
    ),
    group: -1,
    accept: looksLikeSecretValue,
  },
]

// A line of a .env file: every value is treated as a secret, whatever its name.
const ENV_LINE = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=\s*)(.+?)\s*$/gm

const placeholder = (name: string) => `[REDACTED:${name}]`

const isPlaceholder = (text: string) => /^\[REDACTED:[a-z0-9-]+\]$/.test(text)

export type ScrubResult = { text: string; count: number; kinds: string[] }

/** Replaces every secret the rules find in `text`; `isEnvFile` also blanks each KEY=value line's value. */
export function scrub(text: string, rules: readonly SecretRule[], isEnvFile = false): ScrubResult {
  let count = 0
  const kinds = new Set<string>()
  let out = text

  if (isEnvFile) {
    out = out.replace(ENV_LINE, (whole, head: string, value: string) => {
      if (value.trim() === '' || value.trim().startsWith('#') || isPlaceholder(value)) return whole
      count += 1
      kinds.add('env-value')
      return head + placeholder('env-value')
    })
  }

  for (const rule of rules) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g')
    out = out.replace(pattern, (...args: unknown[]) => {
      const match = args[0] as string
      const groups = args.slice(1, -2) as (string | undefined)[]
      if (match.includes('[REDACTED:')) return match
      if (rule.accept !== undefined) {
        const candidate = rule.group === -1 ? groups.slice(1, 4).find(g => g !== undefined) : rule.group ? groups[rule.group - 1] : match
        if (candidate !== undefined && !rule.accept(candidate)) return match
      }
      count += 1
      kinds.add(rule.name)
      if (rule.group === undefined || rule.group === 0) return placeholder(rule.name)
      if (rule.group === -1) {
        // generic-secret: keep the label and any quotes, replace the value
        const [label = '', doubleQuoted, singleQuoted] = groups
        if (doubleQuoted !== undefined) return `${label}"${placeholder(rule.name)}"`
        if (singleQuoted !== undefined) return `${label}'${placeholder(rule.name)}'`
        return label + placeholder(rule.name)
      }
      const secret = groups[rule.group - 1] ?? ''
      const label = groups.slice(0, rule.group - 1).join('')
      return match.startsWith(label) && secret !== '' ? label + placeholder(rule.name) : placeholder(rule.name)
    })
  }

  return { text: out, count, kinds: [...kinds] }
}

/** Builds rules from a user's `{ name, pattern, flags?, group? }` entries, skipping bad ones. */
export function userRules(entries: unknown, onError: (message: string) => void): SecretRule[] {
  if (!Array.isArray(entries)) return []
  const rules: SecretRule[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const { name, pattern, flags, group } = entry as Record<string, unknown>
    if (typeof name !== 'string' || typeof pattern !== 'string') {
      onError('a custom pattern needs a string "name" and "pattern"')
      continue
    }
    try {
      rules.push({
        name: name.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
        pattern: new RegExp(pattern, typeof flags === 'string' ? flags : 'g'),
        group: typeof group === 'number' ? group : undefined,
      })
    } catch (error) {
      onError(`custom pattern "${name}" is not a valid regular expression: ${String(error)}`)
    }
  }
  return rules
}
