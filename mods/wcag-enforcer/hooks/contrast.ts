// A WCAG 2.2 AA text contrast check (success criterion 1.4.3) over the
// color pairs a file sets literally: CSS rule blocks, style="" attributes and
// JSX style objects. A pair needs both a text color and a background in the
// same block; values the file defines as custom properties are resolved.

export type ContrastIssue = {
  line: number
  foreground: string
  background: string
  ratio: number
  required: number
  isLargeText: boolean
}

type Rgba = [number, number, number, number]

const NAMED: Record<string, Rgba> = {
  white: [255, 255, 255, 1],
  black: [0, 0, 0, 1],
  red: [255, 0, 0, 1],
  green: [0, 128, 0, 1],
  blue: [0, 0, 255, 1],
  gray: [128, 128, 128, 1],
  grey: [128, 128, 128, 1],
  silver: [192, 192, 192, 1],
  yellow: [255, 255, 0, 1],
  orange: [255, 165, 0, 1],
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
  }
  return [f(0), f(8), f(4)]
}

export function parseColor(value: string): Rgba | undefined {
  const text = value.trim().toLowerCase()
  if (NAMED[text] !== undefined) return NAMED[text]
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1]
  if (hex !== undefined) {
    const full = hex.length <= 4 ? [...hex].map(d => d + d).join('') : hex
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1]
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(text)
  if (fn?.[1] === undefined || fn[2] === undefined) return undefined
  const parts = fn[2].split(/[\s,/]+/).filter(p => p !== '')
  if (parts.length < 3) return undefined
  const num = (p: string, scale: number) => (p.endsWith('%') ? (parseFloat(p) / 100) * scale : parseFloat(p))
  const alpha = parts[3] === undefined ? 1 : num(parts[3], 1)
  const rgb = fn[1].startsWith('rgb')
    ? ([num(parts[0]!, 255), num(parts[1]!, 255), num(parts[2]!, 255)] as const)
    : hslToRgb(parseFloat(parts[0]!), num(parts[1]!, 1), num(parts[2]!, 1))
  const out: Rgba = [rgb[0], rgb[1], rgb[2], alpha]
  return out.some(Number.isNaN) ? undefined : out
}

/** Lays a translucent color over an opaque one. */
const over = (top: Rgba, bottom: Rgba): Rgba => [
  top[0] * top[3] + bottom[0] * (1 - top[3]),
  top[1] * top[3] + bottom[1] * (1 - top[3]),
  top[2] * top[3] + bottom[2] * (1 - top[3]),
  1,
]

const luminance = ([r, g, b]: Rgba) => {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** The WCAG contrast ratio of a text color on a background (a translucent background sits on white). */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const bg = background[3] < 1 ? over(background, NAMED.white!) : background
  const fg = foreground[3] < 1 ? over(foreground, bg) : foreground
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

type Declaration = { property: string; value: string; line: number }

const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length

const camelToKebab = (name: string) => name.replace(/[A-Z]/g, c => '-' + c.toLowerCase())

/** Custom properties the file defines (`--name: value`), for resolving `var(--name)`. */
function customProperties(text: string): Map<string, string> {
  const vars = new Map<string, string>()
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;}{\n]+)/g)) vars.set(m[1]!, m[2]!.trim())
  return vars
}

function resolve(value: string, vars: Map<string, string>, depth = 0): string {
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)$/.exec(value.trim())
  if (ref === null || depth > 5) return value.trim()
  const defined = vars.get(ref[1]!)
  return defined !== undefined ? resolve(defined, vars, depth + 1) : (ref[2] ?? value).trim()
}

/** The blocks of declarations in a file: CSS rule bodies, style="" attributes, JSX style objects. */
function blocks(text: string): Declaration[][] {
  const found: Declaration[][] = []

  // CSS rule bodies, in stylesheets and in <style> blocks: `selector { ... }`
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    const body = m[1]!
    const start = m.index! + 1
    const decls: Declaration[] = []
    for (const d of body.matchAll(/([a-zA-Z-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) {
      decls.push({ property: d[1]!.toLowerCase(), value: d[2]!, line: lineAt(text, start + d.index!) })
    }
    // A JSX style object `{{ color: '#777', backgroundColor: '#fff' }}` is a block too.
    for (const d of body.matchAll(/([a-zA-Z]+)\s*:\s*(['"`])([^'"`]+)\2/g)) {
      decls.push({ property: camelToKebab(d[1]!), value: d[3]!, line: lineAt(text, start + d.index!) })
    }
    if (decls.length > 0) found.push(decls)
  }

  // style="color: #777; background: #fff"
  for (const m of text.matchAll(/style\s*=\s*(["'])([^"']*)\1/g)) {
    const start = m.index! + m[0].indexOf(m[2]!)
    const decls: Declaration[] = []
    for (const d of m[2]!.matchAll(/([a-zA-Z-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) {
      decls.push({ property: d[1]!.toLowerCase(), value: d[2]!, line: lineAt(text, start + d.index!) })
    }
    if (decls.length > 0) found.push(decls)
  }
  return found
}

const fontSizePx = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  const m = /^(\d*\.?\d+)(px|rem|em|pt)?$/.exec(value.trim())
  if (m === null) return undefined
  const n = parseFloat(m[1]!)
  return m[2] === 'rem' || m[2] === 'em' ? n * 16 : m[2] === 'pt' ? (n * 4) / 3 : n
}

/** Every text/background pair below the WCAG 2.2 AA ratio: 4.5:1, or 3:1 for large text. */
export function checkContrast(text: string): ContrastIssue[] {
  const vars = customProperties(text)
  const issues: ContrastIssue[] = []
  const seen = new Set<string>()

  for (const decls of blocks(text)) {
    const last = (props: string[]) => [...decls].reverse().find(d => props.includes(d.property))
    const fgDecl = last(['color'])
    const bgDecl = last(['background-color', 'background'])
    if (fgDecl === undefined || bgDecl === undefined) continue

    const fgValue = resolve(fgDecl.value, vars)
    // `background` may be a shorthand: take its color when it is one word.
    const bgValue = resolve(bgDecl.value.split(/\s+(?![^(]*\))/).find(part => parseColor(resolve(part, vars)) !== undefined) ?? bgDecl.value, vars)
    const fg = parseColor(fgValue)
    const bg = parseColor(bgValue)
    if (fg === undefined || bg === undefined) continue

    const size = fontSizePx(last(['font-size'])?.value)
    const weight = last(['font-weight'])?.value.trim()
    const isBold = weight === 'bold' || weight === 'bolder' || (weight !== undefined && parseInt(weight, 10) >= 700)
    const isLargeText = size !== undefined && (size >= 24 || (isBold && size >= 18.66))
    const required = isLargeText ? 3 : 4.5
    const ratio = Math.floor(contrastRatio(fg, bg) * 100) / 100
    if (ratio >= required) continue

    const key = `${fgDecl.line}:${fgValue}:${bgValue}`
    if (seen.has(key)) continue
    seen.add(key)
    issues.push({ line: fgDecl.line, foreground: fgValue, background: bgValue, ratio, required, isLargeText })
  }
  return issues.sort((a, b) => a.line - b.line)
}
