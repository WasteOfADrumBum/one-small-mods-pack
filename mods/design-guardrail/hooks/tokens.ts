// Design tokens: read from a JSON tokens file (nested, W3C `$value` or
// Style Dictionary `value` leaves) or a CSS/SCSS file of custom properties,
// and matched against hardcoded values.

export type TokenKind = 'color' | 'length'

export type Token = {
  /** Dotted path for JSON tokens (`color.brand.primary`), the variable for CSS (`--color-brand-primary`). */
  name: string
  /** How to write it in a stylesheet: `var(--color-brand-primary)` or `$color-primary`. */
  cssRef: string
  /** The value as written in the tokens file. */
  raw: string
  kind: TokenKind
  /** `#rrggbbaa` for a color; px for a length. */
  normalized: string | number
  /** What the token is for, judged from its name. */
  group: 'font' | 'space' | 'other'
}

const NAMED_COLORS: Record<string, string> = {
  white: '#ffffffff',
  black: '#000000ff',
  transparent: '#00000000',
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
const hex2 = (n: number) => clamp(n).toString(16).padStart(2, '0')

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** `#rgb`, `#rrggbb`, `rgb()`, `hsl()` and a few names to `#rrggbbaa`; undefined when not a color. */
export function normalizeColor(value: string): string | undefined {
  const text = value.trim().toLowerCase()
  if (NAMED_COLORS[text] !== undefined) return NAMED_COLORS[text]
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)
  if (hex?.[1] !== undefined) {
    let digits = hex[1]
    if (digits.length <= 4) digits = [...digits].map(d => d + d).join('')
    return '#' + (digits.length === 6 ? digits + 'ff' : digits)
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(text)
  if (fn?.[1] === undefined || fn[2] === undefined) return undefined
  const parts = fn[2].split(/[\s,/]+/).filter(p => p !== '')
  if (parts.length < 3) return undefined
  const num = (p: string, scale: number) => (p.endsWith('%') ? (parseFloat(p) / 100) * scale : parseFloat(p))
  const alpha = parts[3] === undefined ? 1 : num(parts[3], 1)
  let rgb: [number, number, number]
  if (fn[1].startsWith('rgb')) {
    rgb = [num(parts[0]!, 255), num(parts[1]!, 255), num(parts[2]!, 255)]
  } else {
    rgb = hslToRgb(parseFloat(parts[0]!), num(parts[1]!, 1), num(parts[2]!, 1))
  }
  if (rgb.some(Number.isNaN) || Number.isNaN(alpha)) return undefined
  return '#' + rgb.map(hex2).join('') + hex2(alpha * 255)
}

/** `12px`, `0.75rem` (at 16px), or a bare number to px; undefined otherwise. */
export function normalizeLength(value: string | number): number | undefined {
  if (typeof value === 'number') return value
  const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(value.trim())
  if (match?.[1] === undefined) return undefined
  const n = parseFloat(match[1])
  return match[2] === 'rem' || match[2] === 'em' ? n * 16 : n
}

const groupOf = (name: string): Token['group'] =>
  /font|text|type|line|leading|tracking|letter/i.test(name)
    ? 'font'
    : /space|spacing|gap|margin|padding|inset|size|sizing|radius/i.test(name)
      ? 'space'
      : 'other'

function makeToken(name: string, cssRef: string, raw: string | number): Token | undefined {
  const text = String(raw)
  const color = normalizeColor(text)
  if (color !== undefined) return { name, cssRef, raw: text, kind: 'color', normalized: color, group: 'other' }
  const length = normalizeLength(raw)
  if (length !== undefined) return { name, cssRef, raw: text, kind: 'length', normalized: length, group: groupOf(name) }
  return undefined
}

/** Tokens from a JSON tokens file; `$value`/`value` leaves and plain leaves alike. */
export function tokensFromJson(data: unknown, path: string[] = []): Token[] {
  if (typeof data === 'string' || typeof data === 'number') {
    const name = path.join('.')
    const token = makeToken(name, `var(--${path.join('-')})`, data)
    return token === undefined ? [] : [token]
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return []
  const record = data as Record<string, unknown>
  const leaf = record.$value ?? record.value
  if (leaf !== undefined && (typeof leaf === 'string' || typeof leaf === 'number')) return tokensFromJson(leaf, path)
  return Object.entries(record)
    .filter(([key]) => !key.startsWith('$'))
    .flatMap(([key, value]) => tokensFromJson(value, [...path, key]))
}

/** Tokens from CSS custom properties (`--x: value`) and SCSS/Less variables (`$x: value`, `@x: value`). */
export function tokensFromStylesheet(text: string): Token[] {
  const tokens: Token[] = []
  for (const match of text.matchAll(/(--[\w-]+|\$[\w-]+|@[\w-]+)\s*:\s*([^;{}]+?)\s*(?:!default\s*)?;/g)) {
    const [, name = '', value = ''] = match
    const cssRef = name.startsWith('--') ? `var(${name})` : name
    const token = makeToken(name, cssRef, value)
    if (token !== undefined) tokens.push(token)
  }
  return tokens
}

export function parseTokens(path: string, text: string): Token[] {
  if (/\.json$/i.test(path)) return tokensFromJson(JSON.parse(text))
  return tokensFromStylesheet(text)
}

const channels = (hex: string) => [1, 3, 5, 7].map(i => parseInt(hex.slice(i, i + 2), 16))

/** The token for a value: an exact match, else the nearest of its kind (and group, for lengths). */
export function suggest(
  tokens: readonly Token[],
  kind: TokenKind,
  normalized: string | number,
  group: Token['group'],
): { token: Token; isExact: boolean } | undefined {
  let candidates = tokens.filter(t => t.kind === kind)
  if (kind === 'length' && group !== 'other') {
    const inGroup = candidates.filter(t => t.group === group)
    if (inGroup.length > 0) candidates = inGroup
  }
  let best: { token: Token; distance: number } | undefined
  for (const token of candidates) {
    const distance =
      kind === 'color'
        ? Math.hypot(...channels(String(token.normalized)).map((c, i) => c - channels(String(normalized))[i]!))
        : Math.abs(Number(token.normalized) - Number(normalized))
    if (best === undefined || distance < best.distance) best = { token, distance }
  }
  return best === undefined ? undefined : { token: best.token, isExact: best.distance === 0 }
}
