#!/usr/bin/env node
// Runs axe-core over one HTML file in jsdom and prints one JSON line:
//   { "violations": [{ rule, impact, help, helpUrl, line, target }] }
// or { "error": "missing-deps" | "failed", "message" } when it cannot.
// axe-core and jsdom are resolved from the project (the working directory),
// so the mod adds no dependencies of its own. jsdom does no layout, so axe's
// own color-contrast rule is off here; the mod checks contrast itself.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const print = value => process.stdout.write(JSON.stringify(value) + '\n')

const file = process.argv[2]
if (!file) {
  print({ error: 'failed', message: 'usage: axe-check.mjs <file.html>' })
  process.exit(0)
}

const projectRequire = createRequire(path.join(process.cwd(), 'package.json'))
let JSDOM
let axeSource
try {
  ;({ JSDOM } = projectRequire('jsdom'))
  axeSource = readFileSync(projectRequire.resolve('axe-core/axe.min.js'), 'utf8')
} catch (error) {
  print({ error: 'missing-deps', message: String(error && error.message) })
  process.exit(0)
}

try {
  const absolute = path.resolve(file)
  const dom = new JSDOM(readFileSync(absolute, 'utf8'), {
    runScripts: 'outside-only',
    includeNodeLocations: true,
    url: pathToFileURL(absolute).href,
  })
  dom.window.eval(axeSource)
  const results = await dom.window.axe.run(dom.window.document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  })
  const lineOf = selector => {
    try {
      const element = dom.window.document.querySelector(selector)
      return element ? dom.nodeLocation(element)?.startLine : undefined
    } catch {
      return undefined
    }
  }
  print({
    violations: results.violations.flatMap(violation =>
      violation.nodes.map(node => ({
        rule: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        line: typeof node.target[0] === 'string' ? lineOf(node.target[0]) : undefined,
        target: node.target.join(' '),
      })),
    ),
  })
} catch (error) {
  print({ error: 'failed', message: String(error && error.message) })
}
