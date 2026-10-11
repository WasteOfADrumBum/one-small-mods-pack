// Finds hardcoded colors, px spacing and px font values in UI source, and
// words the message that names the token to use instead.
import { normalizeColor, normalizeLength, suggest } from './tokens'
import type { Token, TokenKind } from './tokens'

export type Violation = {
  /** 1-based, in the text scanned. */
  line: number
  value: string
  kind: TokenKind
  /** The CSS property or style key it was set on, when known. */
  property?: string
  group: Token['group']
}

const STYLESHEET = /\.(css|scss|sass|less|pcss|postcss|styl)$/i

export const isStylesheet = (path: string) => STYLESHEET.test(path)

const IGNORE = /(design-)?guardrail-ignore/

const HEX = /(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g
const COLOR_FN = /\b(?:rgba?|hsla?)\([^()]*\)/g
// An anchor, an id or a link, not a color: href="#fade", to="#add"
const NOT_A_COLOR_BEFORE = /(?:href|to|id|for|xlink:href|url)\s*[=(]\s*["'`{]?\s*$/

const FONT_PROPS = /^(font|font-size|line-height|letter-spacing|fontSize|lineHeight|letterSpacing|text|leading|tracking)$/
const CSS_LENGTH_DECL =
  /(?<![\w-])(margin(?:-[a-z-]+)?|padding(?:-[a-z-]+)?|gap|row-gap|column-gap|inset(?:-[a-z-]+)?|top|right|bottom|left|font|font-size|line-height|letter-spacing)\s*:\s*([^;{}]+)/g
const PX = /(?<![\w.-])-?\d*\.?\d+px\b/g
const JS_STYLE_LENGTH =
  /\b(margin\w*|padding\w*|gap|rowGap|columnGap|inset\w*|top|right|bottom|left|fontSize|lineHeight|letterSpacing)\s*:\s*(?:(['"`])(-?\d*\.?\d+px)\2|(-?\d*\.?\d+)(?![\w.%'"`]))/g
const TAILWIND_ARBITRARY =
  /(?<![\w-])(-?(?:m|p)[trblxyse]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|text|leading|tracking)-\[(-?\d*\.?\d+px)\]/g

const groupOfProperty = (property: string): Token['group'] => (FONT_PROPS.test(property) ? 'font' : 'space')

/** Blanks `var(...)` (fallbacks included) so a token reference is never flagged. */
const maskTokenRefs = (line: string) => line.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, m => ' '.repeat(m.length))

export function findViolations(text: string, path: string, allow: readonly string[] = ['0', '0px']): Violation[] {
  const allowed = new Set(allow.map(a => a.trim().toLowerCase()))
  const sheet = isStylesheet(path)
  const found: Violation[] = []
  const add = (v: Violation) => {
    if (!allowed.has(v.value.toLowerCase())) found.push(v)
  }

  text.split('\n').forEach((original, index) => {
    if (IGNORE.test(original)) return
    const line = maskTokenRefs(original)
    const lineNo = index + 1
    // Custom property and preprocessor variable definitions are tokens themselves.
    if (/^\s*(--[\w-]+|\$[\w-]+|@[\w-]+)\s*:/.test(line)) return

    for (const match of line.matchAll(HEX)) {
      if (NOT_A_COLOR_BEFORE.test(line.slice(0, match.index))) continue
      add({ line: lineNo, value: match[0], kind: 'color', group: 'other' })
    }
    for (const match of line.matchAll(COLOR_FN)) {
      add({ line: lineNo, value: match[0], kind: 'color', group: 'other' })
    }

    for (const decl of line.matchAll(CSS_LENGTH_DECL)) {
      const [, property = '', value = ''] = decl
      for (const px of value.matchAll(PX)) {
        add({ line: lineNo, value: px[0], kind: 'length', property, group: groupOfProperty(property) })
      }
    }

    if (!sheet) {
      for (const match of line.matchAll(JS_STYLE_LENGTH)) {
        const [, property = '', , quoted, bare] = match
        // A unitless lineHeight is a ratio, not px.
        if (bare !== undefined && property === 'lineHeight') continue
        const value = quoted ?? `${bare}px`
        add({ line: lineNo, value, kind: 'length', property, group: groupOfProperty(property) })
      }
      for (const match of line.matchAll(TAILWIND_ARBITRARY)) {
        const [, utility = '', value = ''] = match
        add({ line: lineNo, value, kind: 'length', property: utility, group: groupOfProperty(utility) })
      }
    }
  })

  // A CSS declaration in a component can be matched by both the CSS and the
  // style-object rules: keep one per line and value.
  const seen = new Set<string>()
  return found.filter(v => {
    const key = `${v.line}:${v.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Drops the violations whose value the file already had: an edit is judged on what it adds. */
export function newViolations(after: readonly Violation[], before: readonly Violation[]): Violation[] {
  const budget = new Map<string, number>()
  for (const v of before) budget.set(v.value.toLowerCase(), (budget.get(v.value.toLowerCase()) ?? 0) + 1)
  return after.filter(v => {
    const left = budget.get(v.value.toLowerCase()) ?? 0
    if (left === 0) return true
    budget.set(v.value.toLowerCase(), left - 1)
    return false
  })
}

const describeToken = (token: Token) =>
  token.cssRef === token.name ? `\`${token.name}\`` : `\`${token.name}\` (\`${token.cssRef}\`)`

/** One line per violation, naming the token to use. */
export function explain(v: Violation, tokens: readonly Token[], lineOffset = 0): string {
  const where = `line ${v.line + lineOffset}`
  const what = v.property === undefined ? `\`${v.value}\`` : `${v.property} \`${v.value}\``
  const normalized = v.kind === 'color' ? normalizeColor(v.value) : normalizeLength(v.value)
  const hit = normalized === undefined ? undefined : suggest(tokens, v.kind, normalized, v.group)
  if (hit === undefined) {
    return `- ${where}: ${what} is hardcoded and no ${v.kind} token exists; add one to the tokens file and use it.`
  }
  if (hit.isExact) return `- ${where}: ${what} → use ${describeToken(hit.token)}.`
  return `- ${where}: ${what} is not a token value → use the nearest token, ${describeToken(hit.token)} = ${hit.token.raw}.`
}
