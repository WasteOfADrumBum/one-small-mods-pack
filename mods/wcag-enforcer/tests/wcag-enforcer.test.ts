import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { checkContrast, contrastRatio, parseColor } from '../hooks/contrast'
import { hasA11yRules, parseAxe, parseEslint, report } from '../hooks/findings'

describe('contrast', () => {
  test('computes the WCAG ratio', () => {
    expect(contrastRatio(parseColor('#000')!, parseColor('#fff')!)).toBe(21)
    expect(Math.round(contrastRatio(parseColor('#777777')!, parseColor('white')!) * 100) / 100).toBe(4.48)
  })

  test('flags a low-contrast CSS rule and passes a good one', () => {
    const css = '.muted {\n  color: #999;\n  background-color: #fff;\n}\n.ok { color: #111; background: #fff; }'
    expect(checkContrast(css)).toEqual([
      { line: 2, foreground: '#999', background: '#fff', ratio: 2.84, required: 4.5, isLargeText: false },
    ])
  })

  test('allows 3:1 for large text', () => {
    expect(checkContrast('h1 { color: #888; background: #fff; font-size: 32px; }')).toEqual([])
    expect(checkContrast('h1 { color: #aaa; background: #fff; font-size: 32px; }')[0]?.required).toBe(3)
  })

  test('resolves custom properties and reads style attributes and JSX style objects', () => {
    const vue = ':root { --muted: #bbb; }\n.a { color: var(--muted); background: #fff; }'
    expect(checkContrast(vue)[0]).toMatchObject({ line: 2, foreground: '#bbb' })
    expect(checkContrast('<p style="color: #ccc; background-color: #fff">x</p>')).toHaveLength(1)
    expect(checkContrast("<p style={{ color: '#ccc', backgroundColor: '#ffffff' }}>x</p>")).toHaveLength(1)
  })
})

describe('findings', () => {
  test('keeps only accessibility rules from ESLint output', () => {
    const out = JSON.stringify([
      {
        messages: [
          { ruleId: 'jsx-a11y/alt-text', line: 3, column: 5, message: 'img elements must have an alt prop' },
          { ruleId: 'no-unused-vars', line: 1, column: 1, message: 'unused' },
        ],
      },
    ])
    expect(parseEslint(out, ['jsx-a11y/'])).toEqual([
      { line: 3, column: 5, rule: 'jsx-a11y/alt-text', message: 'img elements must have an alt prop' },
    ])
    expect(parseEslint('Oops', ['jsx-a11y/'])).toMatchObject({ tool: 'eslint' })
  })

  test('tells an ESLint config with a11y rules from one without', () => {
    expect(hasA11yRules(JSON.stringify({ rules: { 'jsx-a11y/alt-text': [2] } }), ['jsx-a11y/'])).toBe(true)
    expect(hasA11yRules(JSON.stringify({ rules: { 'jsx-a11y/alt-text': ['off'], semi: [2] } }), ['jsx-a11y/'])).toBe(false)
  })

  test('reads the axe script output, and its missing-deps answer', () => {
    expect(parseAxe('{"violations":[{"rule":"image-alt","impact":"critical","help":"Images must have alternative text","line":6,"target":"img"}]}')).toEqual([
      { line: 6, rule: 'axe/image-alt', message: 'Images must have alternative text (at img) [critical]' },
    ])
    expect(parseAxe('{"error":"missing-deps","message":"Cannot find module jsdom"}')).toMatchObject({
      reason: 'axe-core and jsdom are not installed in this project (npm i -D axe-core jsdom)',
    })
  })

  test('writes file, line and rule for each failure', () => {
    expect(report('src/A.tsx', [{ line: 3, column: 5, rule: 'jsx-a11y/alt-text', message: 'needs alt' }])).toBe(
      'wcag-enforcer: 1 accessibility failure (WCAG 2.2 AA) in src/A.tsx. Fix every one before moving on:\n' +
        '- src/A.tsx:3:5 [jsx-a11y/alt-text] needs alt',
    )
  })
})

const ESLINT_CONFIG = JSON.stringify({ rules: { 'jsx-a11y/alt-text': [2] } })
const ESLINT_HIT = JSON.stringify([
  { messages: [{ ruleId: 'jsx-a11y/alt-text', line: 3, column: 5, message: 'img elements must have an alt prop' }] },
])

type Stub = {
  files?: Record<string, string>
  eslintConfig?: string
  eslint?: string
  axe?: string
}

/** Stubs files, processes and display; returns what the mod ran and showed. */
function stubEngine(on: On, stub: Stub) {
  const runs: string[][] = []
  const toasts: string[] = []
  const status: (string | undefined)[] = []
  const find = (path: string) => Object.entries(stub.files ?? {}).find(([end]) => path.endsWith(end))?.[1]
  on('fs.exists', ($, e) => ({ value: find(e.path) !== undefined }))
  on('fs.read', ($, e) => ({ value: find(e.path) ?? '' }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    const stdout = e.argv.includes('--print-config')
      ? stub.eslintConfig ?? ESLINT_CONFIG
      : e.argv.some(a => a.endsWith('axe-check.mjs'))
        ? stub.axe ?? '{"violations":[]}'
        : stub.eslint ?? '[]'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.status', ($, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'done' }))
  on('classic.Stop', () => ({}))
  return { runs, toasts, status }
}

test('hands Claude the jsx-a11y failures of a component it edited', async ($, on) => {
  const { status } = stubEngine(on, { files: { 'Card.tsx': '<img src="a.png" />' }, eslint: ESLINT_HIT })

  const out = await $.tool.call({ tool: 'Edit', file_path: '/work/src/Card.tsx', old_string: 'a', new_string: 'b' })

  expect(out.context?.[0]).toContain('1 accessibility failure (WCAG 2.2 AA) in /work/src/Card.tsx')
  expect(out.context?.[0]).toContain('- /work/src/Card.tsx:3:5 [jsx-a11y/alt-text] img elements must have an alt prop')
  expect(status.at(-1)).toBe('♿ 1 WCAG failure in 1 file')
})

test('runs axe on HTML and reports each violation with its line', async ($, on) => {
  const { runs } = stubEngine(on, {
    files: { 'index.html': '<html><body><img src="a.png"></body></html>' },
    axe: '{"violations":[{"rule":"image-alt","help":"Images must have alternative text","line":6,"target":"img"}]}',
  })

  const out = await $.tool.call({ tool: 'Write', file_path: '/work/index.html', content: '<html></html>' })

  expect(runs[0]?.[1]).toMatch(/scripts\/axe-check\.mjs$/)
  expect(out.context?.[0]).toContain('- /work/index.html:6 [axe/image-alt] Images must have alternative text (at img)')
})

test('reports low contrast in CSS and stays quiet for a clean file', async ($, on) => {
  stubEngine(on, { files: { 'bad.css': '.a { color: #aaa; background: #fff; }', 'good.css': '.a { color: #222; background: #fff; }' } })

  const bad = await $.tool.call({ tool: 'Write', file_path: '/work/bad.css', content: '' })
  const good = await $.tool.call({ tool: 'Write', file_path: '/work/good.css', content: '' })

  expect(bad.context?.[0]).toContain('[wcag/contrast-minimum] text #aaa on #fff has contrast 2.32:1; WCAG 2.2 AA (1.4.3) needs 4.5:1')
  expect(good).toEqual({ result: 'done' })
})

test('says once when the ESLint config has no accessibility rules', async ($, on) => {
  const { toasts, runs } = stubEngine(on, {
    files: { 'A.tsx': 'export const A = 1' },
    eslintConfig: JSON.stringify({ rules: { semi: [2] } }),
  })

  await $.tool.call({ tool: 'Write', file_path: '/work/A.tsx', content: '' })
  await $.tool.call({ tool: 'Write', file_path: '/work/A.tsx', content: '' })

  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('turns on no jsx-a11y/ or vuejs-accessibility/ rules')
  expect(runs.length).toBe(1)
})

test('leaves files it does not check alone', async ($, on) => {
  const { runs } = stubEngine(on, { files: { 'a.ts': '' } })

  const out = await $.tool.call({ tool: 'Write', file_path: '/work/a.ts', content: 'const a = 1' })

  expect(out).toEqual({ result: 'done' })
  expect(runs).toEqual([])
})

test('holds the turn while failures are open, and lets it end once fixed', async ($, on) => {
  const files: Record<string, string> = { 'a.css': '.a { color: #aaa; background: #fff; }' }
  stubEngine(on, { files })

  await $.tool.call({ tool: 'Write', file_path: '/work/a.css', content: '' })
  const held = await $.classic.Stop({ stop_hook_active: false })
  expect(held.block).toContain('these accessibility failures are still open')

  files['a.css'] = '.a { color: #222; background: #fff; }'
  await $.tool.call({ tool: 'Write', file_path: '/work/a.css', content: '' })
  const released = await $.classic.Stop({ stop_hook_active: true })
  expect(released.block).toBeUndefined()
})

test('gives up holding the turn after two reminders', async ($, on) => {
  const { toasts } = stubEngine(on, { files: { 'a.css': '.a { color: #aaa; background: #fff; }' } })

  await $.tool.call({ tool: 'Write', file_path: '/work/a.css', content: '' })
  await $.classic.Stop({ stop_hook_active: false })
  await $.classic.Stop({ stop_hook_active: true })
  const third = await $.classic.Stop({ stop_hook_active: true })

  expect(third.block).toBeUndefined()
  expect(toasts.at(-1)).toContain('ending the turn with accessibility failures left in a.css')
})

test('does nothing when turned off', { options: { enabled: false } }, async ($, on) => {
  const { runs } = stubEngine(on, { files: { 'a.css': '.a { color: #aaa; background: #fff; }' } })

  const out = await $.tool.call({ tool: 'Write', file_path: '/work/a.css', content: '' })

  expect(out).toEqual({ result: 'done' })
  expect(runs).toEqual([])
})
