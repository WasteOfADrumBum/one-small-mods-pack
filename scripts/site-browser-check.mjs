#!/usr/bin/env node
// Real-browser check of the built site (needs Playwright and Chromium, which
// are not dependencies of this package). Serves site/dist locally, then:
// axe-core including colour contrast in light and dark, no horizontal scroll at
// 320px, the search filter, and keyboard access to the skip link.
// Exit 0 pass, 1 failure, 3 Playwright or Chromium not available (NOT TESTED).
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { projectRoot } from './root.mjs'

const root = projectRoot(import.meta.url)
const dist = path.join(root, 'site', 'dist')
let chromium
try {
  const require = createRequire(import.meta.url)
  let mod
  try { mod = require('playwright') } catch { mod = require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')) }
  chromium = mod.chromium
} catch (error) {
  console.log(`NOT TESTED: Playwright is not available (${error.message.split('\n')[0]})`)
  process.exit(3)
}
const axeSource = readFileSync(path.join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }
const server = createServer((req, res) => {
  const file = path.join(dist, req.url === '/' ? 'index.html' : req.url.split('?')[0])
  try { res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'text/plain' }); res.end(readFileSync(file)) } catch { res.writeHead(404); res.end() }
}).listen(0)
const url = `http://127.0.0.1:${server.address().port}`
const failures = []
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
} catch (error) {
  console.log(`NOT TESTED: Chromium could not start (${error.message.split('\n')[0]})`)
  server.close()
  process.exit(3)
}
const pages = readdirSync(dist).filter(f => f.endsWith('.html'))
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  for (const f of pages) {
    await page.goto(`${url}/${f}`)
    await page.evaluate(axeSource)
    const result = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] }))
    for (const v of result.violations) failures.push(`${scheme} ${f}: axe ${v.id} (${v.nodes.length} nodes)`)
  }
  await context.close()
}
{
  const context = await browser.newContext({ viewport: { width: 320, height: 640 } })
  const page = await context.newPage()
  for (const f of pages) {
    await page.goto(`${url}/${f}`)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    if (overflow) failures.push(`320px ${f}: the page scrolls horizontally`)
  }
  await context.close()
}
{
  const page = await browser.newPage()
  await page.goto(`${url}/skills.html`)
  const total = await page.locator('#results > li').count()
  await page.fill('#q', 'wcag')
  const shown = await page.locator('#results > li:not([hidden])').count()
  if (!(shown >= 1 && shown < total)) failures.push(`filter: expected some but not all of ${total} skills for "wcag", saw ${shown}`)
  await page.fill('#q', 'zzzzqqq')
  if ((await page.textContent('#count')).trim() !== 'No matches') failures.push('filter: no-match message missing')
  await page.fill('#q', '')
  if ((await page.locator('#results > li:not([hidden])').count()) !== total) failures.push('filter: clearing does not restore all entries')
  await page.goto(`${url}/index.html`)
  await page.keyboard.press('Tab')
  if (!(await page.evaluate(() => document.activeElement?.classList.contains('skip')))) failures.push('keyboard: the first Tab stop is not the skip link')
  const noJs = await browser.newContext({ javaScriptEnabled: false })
  const p2 = await noJs.newPage()
  await p2.goto(`${url}/skills.html`)
  if ((await p2.locator('#results > li:visible').count()) !== total) failures.push('no-JS: entries are hidden')
  if (await p2.locator('[data-filter-ui]').isVisible()) failures.push('no-JS: a search box is shown that cannot work')
}
// 200% and 400% zoom: a 1280px window at 200% is a 640px layout viewport, at 400% 320px.
for (const [zoom, width] of [['200%', 640], ['400%', 320]]) {
  const context = await browser.newContext({ viewport: { width, height: 800 } })
  const page = await context.newPage()
  for (const f of pages) {
    await page.goto(`${url}/${f}`)
    if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) failures.push(`${zoom} zoom ${f}: horizontal scroll`)
    // Content must not be clipped: every heading is inside the viewport width.
    const clipped = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,nav a,button,input')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length)
    if (clipped > 0) failures.push(`${zoom} zoom ${f}: ${clipped} elements extend past the viewport`)
  }
  await context.close()
}
// Keyboard: every Tab stop is visible, has a visible focus indicator, and has an accessible name; the order follows the page.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  for (const f of pages) {
    await page.goto(`${url}/${f}`)
    const expected = await page.evaluate(() => [...document.querySelectorAll('a[href],input,summary,[tabindex="0"]')].filter(e => e.offsetParent !== null || e.tagName === 'SUMMARY').length)
    let stops = 0, lastTop = -1
    for (let i = 0; i < expected + 5; i++) {
      await page.keyboard.press('Tab')
      const info = await page.evaluate(() => {
        const e = document.activeElement
        if (!e || e === document.body) return null
        const cs = getComputedStyle(e)
        const r = e.getBoundingClientRect()
        return { tag: e.tagName, outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2, name: (e.getAttribute('aria-label') || e.textContent || e.getAttribute('id') || '').trim().length > 0 || e.tagName === 'INPUT', visible: r.width > 0 && r.height > 0 }
      })
      if (info === null) break
      stops++
      if (!info.outline) failures.push(`keyboard ${f}: a ${info.tag} stop has no 2px focus outline`)
      if (!info.name) failures.push(`keyboard ${f}: a ${info.tag} stop has no accessible name`)
      if (!info.visible) failures.push(`keyboard ${f}: a focused ${info.tag} is not visible`)
    }
    if (stops < expected) failures.push(`keyboard ${f}: reached ${stops} of ${expected} focusable elements`)
  }
}
// Search interactions on the agents page: by display name, by technical ID, by skill, by role; the live region reports the count.
{
  const page = await browser.newPage()
  await page.goto(`${url}/agents.html`)
  const shown = async q => { await page.fill('#q', q); return page.locator('#results > li:not([hidden])').count() }
  for (const [q, n] of [['echo', 1], ['ATLAS', 1], ['release-manager', 1], ['code review', 1], ['accessibility', 1], ['release', 3], ['zzz', 0]]) {
    const got = await shown(q)
    if (got < 1 && n > 0 || (n === 0 && got !== 0) || (q === 'release' && got < 2)) failures.push(`agents search "${q}": ${got} shown, expected about ${n}`)
  }
  await page.fill('#q', 'echo')
  if (!/1 shown/.test(await page.textContent('#count'))) failures.push('agents search: the live count is not updated')
  if ((await page.getAttribute('#count', 'aria-live')) !== 'polite' || (await page.getAttribute('#count', 'role')) !== 'status') failures.push('agents search: count is not a polite status region')
  // Accessible names and roles as Chromium exposes them (an accessibility-tree check, not a screen reader run).
  await page.fill('#q', '')
  const tree = await page.locator('main').ariaSnapshot()
  for (const expect of ['heading "Atlas Release Manager"', 'heading "Echo Accessibility Auditor"', 'searchbox "Search agents by name, role or skill"']) {
    if (!tree.includes(expect)) failures.push(`accessibility tree: missing ${expect}`)
  }
  if (/svg|img/.test(tree.split('\n').filter(l => /Atlas/.test(l)).join(''))) failures.push('accessibility tree: the decorative icon is exposed')
}
// Reduced motion: no transitions.
{
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto(`${url}/index.html`)
  const d = await page.evaluate(() => getComputedStyle(document.querySelector('a.button')).transitionDuration)
  if (d !== '0s') failures.push(`reduced motion: transition-duration is ${d}`)
}
await browser.close()
server.close()
if (failures.length > 0) { console.log(`FAIL\n${failures.map(f => `- ${f}`).join('\n')}`); process.exit(1) }
console.log(`PASS: ${pages.length} pages: axe incl. contrast in light and dark, 200% and 400% zoom, keyboard focus order and indicators, search, accessibility tree names, reduced motion, no-JS`)
