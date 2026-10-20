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

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
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
await browser.close()
server.close()
if (failures.length > 0) { console.log(`FAIL\n${failures.map(f => `- ${f}`).join('\n')}`); process.exit(1) }
console.log(`PASS: ${pages.length} pages in light and dark (axe incl. contrast), 320px width, filter, skip link, no-JS`)
