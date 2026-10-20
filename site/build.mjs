#!/usr/bin/env node
// Generates the static site into site/dist from the shipped definitions
// (agents, skills), the catalogs and docs/*.md. No framework, no external
// requests: every page is plain HTML with one stylesheet and one small script.
// Usage: node site/build.mjs [--base /path/]   (run `npm run build` first)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const out = path.join(root, 'site', 'dist')
const lib = await import(pathToFileURL(path.join(root, 'dist', 'lib.mjs')).href)
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const baseArg = process.argv.indexOf('--base')
const base = baseArg > 0 ? process.argv[baseArg + 1] : './'

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// ---- content ---------------------------------------------------------------------------------
const problems = []
const skills = lib.loadSkills(lib.DEFINITIONS_ROOT, problems)
const agents = lib.loadAgents(lib.DEFINITIONS_ROOT, problems)
const { guards, compatibility } = lib.readCatalog(root)
if (agents.length === 0 || skills.length === 0) throw new Error('no agents or skills found')
if (problems.length > 0) throw new Error(`definitions have problems: ${problems.map(p => `${p.file}: ${p.message}`).join('; ')}`)

// ---- minimal Markdown (headings, paragraphs, lists, tables, fences, inline code, links) ---------
function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href.replace(/\.md(#|$)/, '.html$1')}">${label}</a>`)
}
function markdown(src, { shift = 0 } = {}) {
  const lines = src.split('\n')
  const html = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const body = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++])
      i++
      html.push(`<pre tabindex="0"><code>${esc(body.join('\n'))}</code></pre>`)
    } else if (/^#{1,4} /.test(line)) {
      const level = Math.min(6, line.match(/^#+/)[0].length + shift)
      const text = line.replace(/^#+ /, '')
      html.push(`<h${level} id="${slug(text)}">${inline(text)}</h${level}>`)
      i++
    } else if (line.startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++])
      const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const [head, , ...body] = rows
      html.push(`<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table><thead><tr>${cells(head).map(c => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
    } else if (/^[-*] /.test(line)) {
      const items = []
      while (i < lines.length && /^[-*] /.test(lines[i])) items.push(lines[i++].slice(2))
      html.push(`<ul>${items.map(t => `<li>${inline(t)}</li>`).join('')}</ul>`)
    } else if (/^\d+\. /.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ''))
      html.push(`<ol>${items.map(t => `<li>${inline(t)}</li>`).join('')}</ol>`)
    } else if (line.trim() === '') i++
    else {
      const para = []
      while (i < lines.length && lines[i].trim() !== '' && !/^(```|#{1,4} |\||[-*] |\d+\. )/.test(lines[i])) para.push(lines[i++])
      html.push(`<p>${inline(para.join(' '))}</p>`)
    }
  }
  return html.join('\n')
}
const doc = name => readFileSync(path.join(root, name), 'utf8')

// ---- layout ------------------------------------------------------------------------------------
const NAV = [
  ['index.html', 'Home'], ['agents.html', 'Agents'], ['skills.html', 'Skills'], ['guards.html', 'Quality guards'],
  ['security-privacy.html', 'Security and privacy'], ['compatibility.html', 'Integrations'], ['getting-started.html', 'Getting started'],
  ['docs.html', 'Documentation'], ['changelog.html', 'Changelog'],
]
const DOCS = [
  ['cli', 'CLI reference'], ['configuration', 'Configuration'], ['ci', 'Continuous integration'],
  ['troubleshooting', 'Troubleshooting'], ['limitations', 'Known limitations'], ['migration', 'Migrating from 0.1'],
]

function page(file, title, body, { description, filter } = {}) {
  const nav = NAV.map(([href, label]) => `<li><a href="${base}${href}"${href === file ? ' aria-current="page"' : ''}>${label}</a></li>`).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}${file === 'index.html' ? '' : ' | One Small ModsPack'}</title>
<meta name="description" content="${esc(description ?? 'Agents, skills and guards for Claude Code, Codex, GitHub Copilot and Gemini CLI.')}">
<link rel="stylesheet" href="${base}style.css">
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
<header class="site-header">
<p class="brand"><a href="${base}index.html">One Small ModsPack</a></p>
<nav aria-label="Main"><ul>${nav}</ul></nav>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer>
<p>One Small ModsPack ${esc(pkg.version)}. MIT licence. Checked against vendor documentation on ${esc(compatibility.checkedOn)}. This site is generated from the definitions in the repository and makes no network requests.</p>
</footer>
${filter ? `<script src="${base}filter.js" defer></script>` : ''}
</body>
</html>
`
}

const filterBox = (label, n) => `<div class="filter" hidden data-filter-ui>
<label for="q">${label}</label>
<input id="q" type="search" autocomplete="off" aria-controls="results">
<p id="count" role="status" aria-live="polite">${n} shown</p>
</div>`

// ---- pages -------------------------------------------------------------------------------------
const pages = {}

pages['index.html'] = page('index.html', 'One Small ModsPack', `
<h1>One Small ModsPack</h1>
<p class="lead">One set of agent roles, skills and guards for Claude Code, OpenAI Codex, GitHub Copilot and Gemini CLI, and a command line tool that runs the same checks in CI without any AI model.</p>
<ul class="stats" aria-label="At a glance">
<li><strong>${agents.length}</strong> agent roles</li>
<li><strong>${skills.length}</strong> skills</li>
<li><strong>${guards.length}</strong> guards</li>
<li><strong>4</strong> platforms</li>
</ul>
<h2>What it is</h2>
<ul>
<li>Local-first. No telemetry, no paid API required.</li>
<li>Reversible. <code>modspack init</code> previews first, merges into your instruction files and uninstalls cleanly.</li>
<li>Honest. Every result is PASS, FAIL, PARTIAL, SKIPPED, BLOCKED or NOT TESTED. A missing tool is never a pass.</li>
<li>Not a compliance certificate. It never claims HIPAA, WCAG or any other compliance.</li>
</ul>
<h2>Start here</h2>
<p><a class="button" href="${base}getting-started.html">Getting started</a> <a href="${base}compatibility.html">What is verified on each platform</a></p>
<pre tabindex="0"><code>npx one-small-modspack inspect
npx one-small-modspack init
npx one-small-modspack release-check</code></pre>
<p>The package is not yet published to npm; see Getting started for running it from a clone.</p>
`)

const agentCards = agents.map(a => {
  const readOnly = !a.tools.some(t => lib.WRITE_TOOLS.has(t))
  return `<li class="card" data-search="${esc((a.name + ' ' + a.description).toLowerCase())}">
<h2 id="${a.name}">${esc(a.name)}</h2>
<p>${esc(a.description)}</p>
<p><span class="tag">${readOnly ? 'Read-only' : 'Can edit files'}</span> Tools: ${a.tools.map(t => `<code>${esc(t)}</code>`).join(' ')}</p>
<details><summary>When to invoke and what it produces</summary>${markdown(lib.sectionText(a, 'When to invoke') + '\n\n' + lib.sectionText(a, 'Output'))}</details>
</li>`
}).join('\n')
pages['agents.html'] = page('agents.html', 'Agents', `<h1>Agents</h1>
<p>Six roles. Read-only roles cannot edit files, and a test enforces that.</p>
${filterBox('Search agents', agents.length)}
<ul class="cards" id="results">${agentCards}</ul>`, { description: 'The six agent roles.', filter: true })

const skillCards = skills.map(s => `<li class="card" data-search="${esc((s.name + ' ' + s.description).toLowerCase())}">
<h2 id="${s.name}">${esc(s.name)}</h2>
<p>${esc(s.description)}</p>
<details><summary>When to use and safety notes</summary>${markdown(lib.sectionText(s, 'When to use') + '\n\n**Safety**\n\n' + lib.sectionText(s, 'Safety'))}</details>
</li>`).join('\n')
pages['skills.html'] = page('skills.html', 'Skills', `<h1>Skills</h1>
<p>Skills use the open <a href="https://agentskills.io">Agent Skills</a> format, so the same folder works in all four tools.</p>
${filterBox('Search skills', skills.length)}
<ul class="cards" id="results">${skillCards}</ul>`, { description: 'The shared Agent Skills.', filter: true })

const guardCards = guards.map(g => `<li class="card" data-search="${esc((g.name + ' ' + g.checks + ' ' + g.kind).toLowerCase())}">
<h2 id="${g.name}">${esc(g.name)}</h2>
<p><span class="tag">${esc(g.kind)}</span> <span class="tag">${esc(g.effect)}</span></p>
<p>${esc(g.checks)}</p>
<dl>
<dt>Runs</dt><dd>${esc(g.runs)}</dd>
<dt>On failure</dt><dd>${esc(g.failure)}</dd>
<dt>Missing dependency</dt><dd>${esc(g.missingDependency)}</dd>
<dt>Configure</dt><dd>${esc(g.configure)}</dd>
<dt>Troubleshooting</dt><dd>${esc(g.troubleshooting)}</dd>
<dt>CLI</dt><dd><code>${esc(g.cli)}</code></dd>
</dl></li>`).join('\n')
pages['guards.html'] = page('guards.html', 'Quality guards', `<h1>Quality guards</h1>
<p>Guards are checks on code. Mods run some of them while Claude Code works; the CLI runs all of them in CI.</p>
${filterBox('Search guards', guards.length)}
<ul class="cards" id="results">${guardCards}</ul>`, { description: 'Quality, accessibility, security and privacy guards.', filter: true })

pages['security-privacy.html'] = page('security-privacy.html', 'Security and privacy', `<h1>Security and privacy</h1>
${markdown(`## What is checked

- Secrets committed to the working tree and the newest 200 commits of history, tracked \`.env\` files.
- Risky GitHub Actions workflows and package install scripts.
- Secrets exposed to the browser through public environment variables, public source maps and debug files.
- Personal data (names with health fields, SSN, card numbers with a checksum, IBAN, dates of birth, medical record and insurance numbers, emails and phone numbers).
- Optionally, the dependency audit and gitleaks or osv-scanner when they are already installed.

## How findings are reported

Every finding has a severity, a confidence (confirmed, likely or possible), a location and a remediation. Evidence is masked: the report shows the length of a value and a sha256 fingerprint, never the value. Possible findings are listed but never fail the gate.

## HIPAA-related review

When health data appears in code, the privacy check adds a review that marks each item POTENTIAL CONCERN, NO CONCERN FOUND or NOT ASSESSED. **It is not a HIPAA assessment and does not show compliance.** Business associate agreements, risk analysis, access policies, training and breach procedures are NOT ASSESSED, and the report says a qualified person must review them.

## What it will not do

- It never rotates a credential or changes a secret. If one is real, rotate it yourself.
- It sends nothing anywhere. The dependency audit is off unless you switch it on.
- It does not treat repository content or third-party skills as instructions.
`)}`, { description: 'What the security and privacy checks cover, and their limits.' })

const caps = Object.keys(compatibility.capabilities)
const plats = Object.keys(compatibility.platforms)
const cell = (cap, p) => {
  const c = compatibility.matrix[cap][p]
  return `<td><span class="status status-${esc(c.status)}">${esc(c.status)}</span> <span class="muted">${esc(c.verified)}</span><br><span class="note">${esc(c.note)}</span></td>`
}
pages['compatibility.html'] = page('compatibility.html', 'Integrations', `<h1>Integrations</h1>
<p>Checked against vendor documentation on ${esc(compatibility.checkedOn)}. <strong>Supported</strong> is used only where the behaviour was exercised in a real tool or test harness. <strong>Partial</strong> means built from the documentation and verified statically (file formats, fixtures, recorded payloads). <strong>CLI fallback</strong> means use the CLI in CI instead.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Compatibility matrix">
<table>
<caption>Capability by platform</caption>
<thead><tr><th scope="col">Capability</th>${plats.map(p => `<th scope="col">${esc(compatibility.platforms[p].label)}</th>`).join('')}</tr></thead>
<tbody>${caps.map(cap => `<tr><th scope="row">${esc(cap)}<br><span class="note">${esc(compatibility.capabilities[cap])}</span></th>${plats.map(p => cell(cap, p)).join('')}</tr>`).join('')}</tbody>
</table></div>
<h2>Tool versions and documentation</h2>
<ul>${plats.map(p => `<li><strong>${esc(compatibility.platforms[p].label)}</strong>: ${esc(compatibility.platforms[p].version)}. ${compatibility.platforms[p].docs.map(d => `<a href="${esc(d)}">${esc(new URL(d).hostname)}</a>`).join(', ')}</li>`).join('')}</ul>`, { description: 'What works on each platform and how it was verified.' })

pages['getting-started.html'] = page('getting-started.html', 'Getting started', markdown(doc('docs/getting-started.md')))
pages['docs.html'] = page('docs.html', 'Documentation', `<h1>Documentation</h1><ul>${DOCS.map(([n, t]) => `<li><a href="${base}docs-${n}.html">${t}</a></li>`).join('')}</ul>`)
for (const [n] of DOCS) pages[`docs-${n}.html`] = page('docs.html', DOCS.find(d => d[0] === n)[1], markdown(doc(`docs/${n}.md`)))
pages['changelog.html'] = page('changelog.html', 'Changelog', markdown(doc('CHANGELOG.md')))

// ---- assets ------------------------------------------------------------------------------------
const css = `
:root{--bg:#ffffff;--fg:#1a1a1a;--muted:#595959;--accent:#0b57d0;--border:#c9c9c9;--card:#f6f7f9;--code:#eef0f3;--ok:#0b6b2f;--warn:#7a4b00;--bad:#a1180f}
@media (prefers-color-scheme:dark){:root{--bg:#121316;--fg:#ececec;--muted:#b3b3b3;--accent:#8ab4f8;--border:#3c3f44;--card:#1b1d21;--code:#24272c;--ok:#7ddc9a;--warn:#f2c26b;--bad:#ff9d94}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:1rem/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.skip{position:absolute;left:1rem;top:-4rem;background:var(--bg);color:var(--fg);padding:.5rem 1rem;border:2px solid var(--accent);z-index:10}
.skip:focus{top:1rem}
.site-header,main,footer{max-width:68rem;margin:0 auto;padding:1rem}
.site-header{border-bottom:1px solid var(--border)}
.brand{font-weight:700;font-size:1.25rem;margin:0}
.brand a{color:var(--fg);text-decoration:none}
nav ul{list-style:none;display:flex;flex-wrap:wrap;gap:.25rem 1rem;padding:0;margin:.5rem 0 0}
nav a{display:inline-block;padding:.5rem 0;min-height:44px}
nav a[aria-current=page]{font-weight:700;text-decoration:none;border-bottom:3px solid var(--accent)}
h1{font-size:2rem;line-height:1.2}
.lead{font-size:1.2rem}
.button{display:inline-block;background:var(--accent);color:var(--bg);padding:.75rem 1.25rem;border-radius:.4rem;text-decoration:none;font-weight:600;min-height:44px}
pre,code{background:var(--code);border-radius:.25rem}
code{padding:.1em .3em;font-size:.9em;overflow-wrap:anywhere}
pre code{overflow-wrap:normal}
pre{padding:1rem;overflow:auto}
pre code{padding:0}
.cards{list-style:none;padding:0;display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(min(100%,22rem),1fr))}
.card{background:var(--card);border:1px solid var(--border);border-radius:.5rem;padding:1rem}
.card h2{margin-top:0;font-size:1.2rem}
.tag{display:inline-block;border:1px solid var(--border);border-radius:1rem;padding:0 .6rem;font-size:.85rem;margin-right:.25rem}
dt{font-weight:700;margin-top:.5rem}
dd{margin:0}
.stats{list-style:none;display:flex;flex-wrap:wrap;gap:1rem;padding:0}
.stats li{background:var(--card);border:1px solid var(--border);border-radius:.5rem;padding:.5rem 1rem}
.stats strong{font-size:1.5rem;display:block}
.filter{margin:1rem 0}
.filter label{display:block;font-weight:600}
.filter input{width:100%;max-width:28rem;padding:.6rem;font:inherit;color:var(--fg);background:var(--bg);border:2px solid var(--border);border-radius:.4rem;min-height:44px}
.table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:42rem}
th,td{border:1px solid var(--border);padding:.5rem;text-align:left;vertical-align:top}
caption{text-align:left;font-weight:700;padding:.5rem 0}
.note,.muted{color:var(--muted);font-size:.9rem;font-weight:400}
.status{font-weight:700}.status-supported{color:var(--ok)}.status-partial,.status-cli-fallback{color:var(--warn)}.status-unsupported,.status-not-tested{color:var(--bad)}
footer{border-top:1px solid var(--border);color:var(--muted);font-size:.9rem}
@media (prefers-reduced-motion:no-preference){a,.button{transition:background-color .15s,color .15s}}
@media (max-width:40rem){h1{font-size:1.6rem}}
`
const js = `// Progressive enhancement: without this script every entry stays visible.
(function () {
  var ui = document.querySelector('[data-filter-ui]');
  var list = document.getElementById('results');
  if (!ui || !list) return;
  ui.hidden = false;
  var input = document.getElementById('q');
  var count = document.getElementById('count');
  var items = Array.prototype.slice.call(list.children);
  function apply() {
    var terms = input.value.toLowerCase().split(/\\s+/).filter(Boolean);
    var shown = 0;
    items.forEach(function (li) {
      var hay = li.getAttribute('data-search') || '';
      var ok = terms.every(function (t) { return hay.indexOf(t) !== -1; });
      li.hidden = !ok;
      if (ok) shown++;
    });
    count.textContent = shown === 0 ? 'No matches' : shown + ' shown';
  }
  input.addEventListener('input', apply);
})();
`

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const [file, html] of Object.entries(pages)) writeFileSync(path.join(out, file), html)
writeFileSync(path.join(out, 'style.css'), css.trim() + '\n')
writeFileSync(path.join(out, 'filter.js'), js)
console.log(`site: ${Object.keys(pages).length} pages in site/dist`)
