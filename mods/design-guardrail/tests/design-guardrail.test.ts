import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { explain, findViolations, newViolations } from '../hooks/scan'
import { normalizeColor, parseTokens, tokensFromJson, tokensFromStylesheet } from '../hooks/tokens'

const TOKENS_JSON = JSON.stringify({
  color: {
    brand: { primary: { $value: '#3366FF' } },
    text: { value: 'rgb(17, 17, 17)' },
  },
  space: { '2': '8px', '3': '12px', '4': '1rem' },
  font: { size: { body: '16px', small: '14px' } },
})

describe('tokens', () => {
  test('reads nested JSON, $value and value leaves', () => {
    const tokens = tokensFromJson(JSON.parse(TOKENS_JSON))
    expect(tokens.map(t => t.name)).toEqual([
      'color.brand.primary',
      'color.text',
      'space.2',
      'space.3',
      'space.4',
      'font.size.body',
      'font.size.small',
    ])
    expect(tokens[0]).toMatchObject({ cssRef: 'var(--color-brand-primary)', normalized: '#3366ffff' })
    expect(tokens[4]?.normalized).toBe(16)
  })

  test('reads CSS custom properties and SCSS variables', () => {
    const tokens = tokensFromStylesheet(':root {\n  --color-accent: #f60;\n  --space-1: 4px;\n}\n$radius-sm: 2px;')
    expect(tokens.map(t => t.cssRef)).toEqual(['var(--color-accent)', 'var(--space-1)', '$radius-sm'])
  })

  test('normalizes the color forms to one', () => {
    expect(normalizeColor('#36f')).toBe('#3366ffff')
    expect(normalizeColor('rgb(51 102 255)')).toBe('#3366ffff')
    expect(normalizeColor('hsl(225, 100%, 60%)')).toBe('#3366ffff')
    expect(normalizeColor('banana')).toBeUndefined()
  })
})

describe('findViolations', () => {
  test('finds hex, rgb and px spacing and font values in CSS', () => {
    const css = '.btn {\n  color: #3366ff;\n  background: rgba(0, 0, 0, 0.5);\n  padding: 12px 8px;\n  font-size: 14px;\n  margin: 0;\n}'
    expect(findViolations(css, 'a.css').map(v => `${v.line}:${v.value}`)).toEqual([
      '2:#3366ff',
      '3:rgba(0, 0, 0, 0.5)',
      '4:12px',
      '4:8px',
      '5:14px',
    ])
  })

  test('finds style objects and Tailwind arbitrary values in components', () => {
    const tsx = '<div style={{ marginTop: 12, fontSize: "14px", lineHeight: 1.5 }} className="p-[10px] text-[#ff0000]" />'
    expect(findViolations(tsx, 'a.tsx').map(v => v.value)).toEqual(['#ff0000', '12px', '14px', '10px'])
  })

  test('passes tokens, anchors, ignored lines and token definitions', () => {
    const tsx = [
      '<a href="#add">skip</a>',
      '<div style={{ padding: "var(--space-3)", color: "var(--color-text, #111)" }} />',
      '<div style={{ margin: 0 }} />',
      'const legacy = "#abcdef" // guardrail-ignore',
    ].join('\n')
    expect(findViolations(tsx, 'a.tsx')).toEqual([])
    expect(findViolations(':root { --brand: #3366ff; }\n--x: 4px;', 'tokens.css').length).toBe(1)
  })

  test('judges an edit only on the values it adds', () => {
    const before = findViolations('color: #111111;', 'a.css')
    const after = findViolations('color: #111111;\nborder-color: #222222;', 'a.css')
    expect(newViolations(after, before).map(v => v.value)).toEqual(['#222222'])
  })

  test('names the exact token, or the nearest one', () => {
    const tokens = parseTokens('design-tokens.json', TOKENS_JSON)
    const [hex, px] = findViolations('color: #36F;\npadding: 13px;', 'a.css')
    expect(explain(hex!, tokens)).toBe('- line 1: `#36F` → use `color.brand.primary` (`var(--color-brand-primary)`).')
    expect(explain(px!, tokens, 10)).toBe(
      '- line 12: padding `13px` is not a token value → use the nearest token, `space.3` (`var(--space-3)`) = 12px.',
    )
  })
})

/** Stubs the project's files and the display calls; `files` maps a path ending to its text. */
function stubEngine(on: On, files: Record<string, string>) {
  const find = (path: string) => Object.entries(files).find(([end]) => path.endsWith(end))?.[1]
  const toasts: string[] = []
  on('fs.exists', ($, e) => ({ value: find(e.path) !== undefined }))
  on('fs.read', ($, e) => ({ value: find(e.path) ?? '' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: 'written' }))
  return { toasts }
}

test('blocks a Write that hardcodes a color and names the token to use', async ($, on) => {
  stubEngine(on, { 'design-tokens.json': TOKENS_JSON })

  const out = await $.tool.call({
    tool: 'Write',
    file_path: '/work/src/Button.css',
    content: '.btn {\n  color: #3366ff;\n  padding: var(--space-3);\n}',
  })

  expect(out.deny).toContain('hardcodes 1 value that should be design tokens (from design-tokens.json)')
  expect(out.deny).toContain('- line 2: `#3366ff` → use `color.brand.primary` (`var(--color-brand-primary)`).')
})

test('blocks an Edit on its file line numbers and spares values already there', async ($, on) => {
  stubEngine(on, {
    'design-tokens.json': TOKENS_JSON,
    'Card.tsx': 'export const Card = () => (\n  <div style={{ color: "#111111" }}>\n    hi\n  </div>\n)',
  })

  const out = await $.tool.call({
    tool: 'Edit',
    file_path: '/work/src/Card.tsx',
    old_string: '  <div style={{ color: "#111111" }}>',
    new_string: '  <div style={{ color: "#111111", fontSize: 14 }}>',
  })

  expect(out.deny).toContain('- line 2: fontSize `14px` → use `font.size.small` (`var(--font-size-small)`).')
  expect(out.deny).not.toContain('#111111')
})

test('lets token-only UI edits through', async ($, on) => {
  stubEngine(on, { 'design-tokens.json': TOKENS_JSON })

  const out = await $.tool.call({
    tool: 'Write',
    file_path: '/work/src/ok.css',
    content: '.ok { color: var(--color-text); gap: var(--space-2); margin: 0; }',
  })

  expect(out).toEqual({ result: 'written' })
})

test('ignores files that are not UI files', async ($, on) => {
  stubEngine(on, { 'design-tokens.json': TOKENS_JSON })

  const out = await $.tool.call({ tool: 'Write', file_path: '/work/scripts/build.ts', content: 'const red = "#ff0000"' })

  expect(out).toEqual({ result: 'written' })
})

test('reads the tokens file path from its option, and a CSS tokens file', { options: { tokensFile: 'styles/tokens.css' } }, async ($, on) => {
  stubEngine(on, { 'styles/tokens.css': ':root { --space-md: 16px; }' })

  const out = await $.tool.call({ tool: 'Write', file_path: '/work/a.scss', content: '.a { margin: 16px; }' })

  expect(out.deny).toContain('- line 1: margin `16px` → use `--space-md` (`var(--space-md)`).')
})

test('steps aside with one toast when no tokens file exists', async ($, on) => {
  const { toasts } = stubEngine(on, {})

  const first = await $.tool.call({ tool: 'Write', file_path: '/work/a.css', content: '.a { color: #fff; }' })
  await $.tool.call({ tool: 'Write', file_path: '/work/b.css', content: '.b { color: #000; }' })

  expect(first).toEqual({ result: 'written' })
  expect(toasts).toEqual(['design-guardrail: no tokens file at design-tokens.json; set tokensFile to turn the guard on'])
})

test('does nothing when the project config turns it off', async ($, on) => {
  stubEngine(on, {
    'design-tokens.json': TOKENS_JSON,
    'design-guardrail.json': JSON.stringify({ enabled: false }),
  })

  const out = await $.tool.call({ tool: 'Write', file_path: '/work/a.css', content: '.a { color: #fff; }' })

  expect(out).toEqual({ result: 'written' })
})
