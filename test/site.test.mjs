// The site is generated from the definitions, so these tests check that what
// the pages say matches the files, that every link resolves, and that each page
// passes axe-core (structure and names; contrast is checked on the CSS tokens
// below and in a real browser by scripts/site-browser-check.mjs).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import axe from 'axe-core'
import { JSDOM } from 'jsdom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'site', 'dist')
const lib = await import(pathToFileURL(path.join(root, 'dist', 'lib.mjs')).href)

execFileSync(process.execPath, [path.join(root, 'site', 'build.mjs')], { cwd: root })
const files = readdirSync(dist).filter(f => f.endsWith('.html'))
const read = f => readFileSync(path.join(dist, f), 'utf8')

test('site: every agent, skill and guard in the definitions is on its page, and nothing else', () => {
  const problems = []
  const skills = lib.loadSkills(lib.DEFINITIONS_ROOT, problems)
  const agents = lib.loadAgents(lib.DEFINITIONS_ROOT, problems)
  const { guards } = lib.readCatalog(root)
  assert.deepEqual(problems, [])
  assert.equal(agents.length, 6)
  assert.ok(skills.length >= 12)
  assert.ok(guards.length >= 7)
  const ids = (file, tag = 'h2') => [...read(file).matchAll(new RegExp(`<${tag} id="([^"]+)"`, 'g'))].map(m => m[1]).sort()
  assert.deepEqual([...read('agents.html').matchAll(/<h2 id="([^"]+)"><svg/g)].map(m => m[1]).sort(), agents.map(a => a.name).sort())
  assert.deepEqual(ids('skills.html'), skills.map(s => s.name).sort())
  assert.deepEqual(ids('guards.html'), guards.map(g => g.name).sort())
  assert.match(read('index.html'), new RegExp(`<strong>${agents.length}</strong> agent roles`))
})

test('site: the CLI commands in the docs exist in --help, and the other way round', () => {
  const help = execFileSync(process.execPath, [path.join(root, 'dist', 'modspack.mjs'), '--help'], { encoding: 'utf8' })
  const real = [...help.split('\nOptions')[0].matchAll(/^ {2}([a-z-]+)(?: <platform>)? +[a-z(]/gm)].map(m => m[1]).sort()
  const documented = [...readFileSync(path.join(root, 'docs', 'cli.md'), 'utf8').matchAll(/^\| `([a-z-]+)(?: <platform>)?` \|/gm)].map(m => m[1]).sort()
  assert.deepEqual(documented, real)
})

test('site: every internal link and in-page anchor resolves', () => {
  for (const f of files) {
    const dom = new JSDOM(read(f))
    for (const a of dom.window.document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href')
      if (/^(https?:|mailto:)/.test(href)) continue
      const [target, hash] = href.split('#')
      const file = target === '' ? f : target.replace(/^\.\//, '')
      assert.ok(existsSync(path.join(dist, file)), `${f}: ${href} points to a missing file`)
      if (hash) assert.ok(new JSDOM(read(file)).window.document.getElementById(hash), `${f}: ${href} points to a missing anchor`)
    }
    for (const el of dom.window.document.querySelectorAll('link[href],script[src]')) {
      assert.ok(existsSync(path.join(dist, el.getAttribute('href') ?? el.getAttribute('src'))), `${f}: missing asset`)
    }
  }
})

test('site: makes no external requests', () => {
  for (const f of files) {
    const doc = new JSDOM(read(f)).window.document
    assert.equal(doc.querySelectorAll('script[src^="http"],link[href^="http"],img[src^="http"],iframe').length, 0, f)
  }
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(readFileSync(path.join(dist, 'filter.js'), 'utf8')))
})

test('site: structure, and axe-core finds no violations on any page', async () => {
  const titles = new Set()
  for (const f of files) {
    const dom = new JSDOM(read(f), { runScripts: 'outside-only' })
    const { document } = dom.window
    assert.equal(document.documentElement.lang, 'en', f)
    assert.equal(document.querySelectorAll('h1').length, 1, `${f}: exactly one h1`)
    assert.equal(document.querySelectorAll('main').length, 1, f)
    assert.ok(document.querySelector('a.skip[href="#main"]'), `${f}: skip link`)
    assert.ok(!titles.has(document.title), `${f}: duplicate title ${document.title}`)
    titles.add(document.title)
    dom.window.eval(axe.source)
    const result = await dom.window.axe.run(dom.window.document, { rules: { 'color-contrast': { enabled: false } } })
    assert.deepEqual(Array.from(result.violations, v => `${f}: ${v.id} ${v.nodes.map(n => n.target).join(',')}`), [])
  }
})

test('site: the colour tokens meet WCAG AA text contrast in light and dark', () => {
  const css = readFileSync(path.join(dist, 'style.css'), 'utf8')
  const parse = block => Object.fromEntries([...block.matchAll(/--([a-z]+):(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]))
  const light = parse(css.match(/:root\{([^}]*)\}/)[1])
  const dark = parse(css.match(/prefers-color-scheme:dark\)\{:root\{([^}]*)\}/)[1])
  const lum = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  for (const [mode, t] of [['light', light], ['dark', dark]]) {
    const full = mode === 'dark' ? { ...light, ...dark } : t
    for (const [fg, bg] of [['fg', 'bg'], ['fg', 'card'], ['fg', 'code'], ['muted', 'bg'], ['muted', 'card'], ['accent', 'bg'], ['accent', 'card'], ['ok', 'bg'], ['ok', 'card'], ['warn', 'bg'], ['warn', 'card'], ['bad', 'bg'], ['bad', 'card'], ['bg', 'accent']]) {
      assert.ok(ratio(full[fg], full[bg]) >= 4.5, `${mode}: ${fg} on ${bg} is ${ratio(full[fg], full[bg]).toFixed(2)}:1`)
    }
  }
})

test('site: every agent shows its display name, role, ID and the required sections, from the definitions', () => {
  const agents = lib.loadAgents(lib.DEFINITIONS_ROOT, [])
  const skills = lib.loadSkills(lib.DEFINITIONS_ROOT, [])
  const identities = lib.resolveIdentities(agents, lib.loadDefaultIdentities(lib.DEFINITIONS_ROOT))
  const doc = new JSDOM(read('agents.html')).window.document
  const cards = [...doc.querySelectorAll('li.agent')]
  assert.equal(cards.length, 6)
  for (const a of agents) {
    const ident = identities.find(i => i.id === a.name)
    const card = cards.find(c => c.querySelector('h2').id === a.name)
    assert.ok(card, a.name)
    assert.equal(card.querySelector('.agent-name').textContent, ident.name)
    assert.equal(card.querySelector('.role').textContent, ident.role)
    assert.ok(card.textContent.includes(a.name), 'technical ID shown')
    assert.deepEqual([...card.querySelectorAll('h3')].map(h => h.textContent), ['Responsibilities', 'When to invoke it', 'Related skills', 'Supported AI platforms and how to invoke', 'Source definition', 'Limitations'])
    assert.ok(card.querySelectorAll('svg[aria-hidden="true"]').length === 1, 'decorative icon is hidden from assistive technology')
    const links = [...card.querySelectorAll('.inline a')].map(l => l.getAttribute('href').split('#')[1])
    assert.ok(links.length >= 1 && links.every(n => skills.some(s => s.name === n)), `${a.name}: related skills exist`)
    assert.ok(card.querySelector(`a[href$="agents/${a.name}.md"]`), 'source link')
    assert.equal(card.querySelectorAll('li strong').length >= 4, true, 'all four platforms listed')
  }
})

test('site: styled controls keep a border in Windows high contrast (forced colors)', () => {
  const css = readFileSync(path.join(dist, 'style.css'), 'utf8')
  assert.match(css, /@media \(forced-colors:active\)\{\.button\{border:2px solid ButtonText\}\}/)
})
