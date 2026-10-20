// The quality, accessibility, design and package gates. They run the
// project's own tools and the mods' pure rules; nothing here calls a model.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { checkContrast } from '../../mods/wcag-enforcer/hooks/contrast'
import { contrastFindings, hasA11yRules, parseAxe, parseEslint } from '../../mods/wcag-enforcer/hooks/findings'
import type { Finding as A11yFinding } from '../../mods/wcag-enforcer/hooks/findings'
import { findViolations, explain } from '../../mods/design-guardrail/hooks/scan'
import { parseTokens } from '../../mods/design-guardrail/hooks/tokens'
import { DEFAULT_SCRIPTS, LOCKFILES, planScripts, scriptArgv, tail } from '../../mods/qa-gate/hooks/scripts'
import type { Check, PackageManager } from '../../mods/qa-gate/hooks/scripts'
import type { ModspackConfig } from '../core/config'
import { matchesAny, readText, sourceFiles } from '../core/files'
import { PACKAGE_ROOT } from '../core/paths'
import { gateStatus } from '../core/report'
import type { CheckResult, Finding, GateResult } from '../core/report'
import { fingerprint } from './secrets'

const readPackage = (dir: string): Record<string, any> | undefined => {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}

const notApplicable = (name: string, why: string): CheckResult => ({ name, status: 'SKIPPED', summary: `not applicable: ${why}`, required: false })

function detectManager(dir: string): PackageManager {
  return LOCKFILES.find(([file]) => existsSync(path.join(dir, file)))?.[1] ?? 'npm'
}

// ---- quality ----------------------------------------------------------------------------------

const QUALITY_CHECKS: readonly (Check | 'build')[] = ['lint', 'typecheck', 'spellcheck', 'test', 'build']

export function qualityGate(dir: string, config: ModspackConfig): GateResult {
  const pkg = readPackage(dir)
  if (pkg === undefined) return { gate: 'quality', status: 'SKIPPED', checks: [notApplicable('scripts', 'no package.json')] }
  const scripts = (pkg.scripts ?? {}) as Record<string, unknown>
  const manager = detectManager(dir)
  const names = Object.fromEntries(Object.entries(config.quality.scripts)) as Partial<Record<Check, string[]>>
  const planned = planScripts(scripts, names, ['lint', 'typecheck', 'spellcheck', 'test'])
  const buildScript = (config.quality.scripts.build ?? ['build']).find(n => typeof scripts[n] === 'string' && String(scripts[n]).trim() !== '')
  if (buildScript !== undefined) planned.push({ check: 'build' as Check, script: buildScript })
  const hasDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0
  const checks: CheckResult[] = []

  for (const name of QUALITY_CHECKS) {
    const entry = planned.find(p => (p.check as string) === name)
    const required = config.quality.required.includes(name)
    if (entry === undefined) {
      const wanted = (config.quality.scripts[name] ?? DEFAULT_SCRIPTS[name as Check] ?? ['build']).join(' / ')
      checks.push(
        required
          ? { name, status: 'BLOCKED', summary: `required but the project has no ${name} script (looked for ${wanted}); a missing script is not a pass`, required: true }
          : { name, status: 'SKIPPED', summary: `no ${name} script (looked for ${wanted})`, required: false },
      )
      continue
    }
    if (hasDeps && !existsSync(path.join(dir, 'node_modules'))) {
      checks.push({ name, status: 'BLOCKED', summary: `dependencies are not installed (no node_modules); run ${manager} install first`, required: true, command: scriptArgv(manager, entry.script).join(' ') })
      continue
    }
    const argv = scriptArgv(manager, entry.script)
    const started = Date.now()
    const ran = spawnSync(argv[0]!, argv.slice(1), { cwd: dir, encoding: 'utf8', timeout: config.quality.timeoutSeconds * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: 'true' } })
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    const command = argv.join(' ')
    if (ran.error !== undefined && (ran.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
      checks.push({ name, status: 'FAIL', summary: `${entry.script} did not finish within ${config.quality.timeoutSeconds}s`, required: true, command })
    } else if (ran.error !== undefined) {
      checks.push({ name, status: 'BLOCKED', summary: `could not run ${argv[0]}: ${ran.error.message}`, required: true, command })
    } else if (ran.status === 0) {
      checks.push({ name, status: 'PASS', summary: `${entry.script} passed in ${seconds}s`, required: true, command })
    } else {
      checks.push({ name, status: 'FAIL', summary: `${entry.script} exited ${ran.status} in ${seconds}s`, required: true, command, details: tail(`${ran.stdout}\n${ran.stderr}`, 25, 2000).split('\n') })
    }
  }
  return { gate: 'quality', status: gateStatus(checks), checks }
}

// ---- design -----------------------------------------------------------------------------------

const UI = /\.(css|scss|sass|less|tsx|jsx|vue|html|svelte|astro)$/
const TOKEN_CANDIDATES = ['design-tokens.json', 'tokens.json', 'src/design-tokens.json', 'src/styles/tokens.css', 'src/tokens.css', 'styles/tokens.css']

export function designGate(dir: string, config: ModspackConfig): GateResult {
  const required = config.release.requiredGates.includes('design')
  let tokensFile = config.design.tokensFile
  if (tokensFile === undefined) {
    try {
      tokensFile = (JSON.parse(readFileSync(path.join(dir, '.claude/guardrail-mods/design-guardrail.json'), 'utf8')) as { tokensFile?: string }).tokensFile
    } catch {
      tokensFile = undefined
    }
  }
  tokensFile ??= TOKEN_CANDIDATES.find(f => existsSync(path.join(dir, f)))
  if (tokensFile === undefined || !existsSync(path.join(dir, tokensFile))) {
    return { gate: 'design', status: 'SKIPPED', checks: [notApplicable('tokens', 'no design tokens file (projects without a design system are left alone)')] }
  }
  let tokens
  try {
    tokens = parseTokens(tokensFile, readFileSync(path.join(dir, tokensFile), 'utf8'))
  } catch (error) {
    return { gate: 'design', status: required ? 'BLOCKED' : 'PARTIAL', checks: [{ name: 'tokens', status: 'BLOCKED', summary: `${tokensFile} could not be read: ${(error as Error).message}`, required }] }
  }
  const files = sourceFiles(dir, config.exclude).files.filter(f => UI.test(f) && f !== tokensFile && !/\.(test|spec|stories)\./.test(f))
  const findings: Finding[] = []
  for (const file of files) {
    const read = readText(path.join(dir, file))
    if (!('text' in read)) continue
    for (const v of findViolations(read.text, file, { allow: config.design.allow })) {
      const fp = fingerprint('hardcoded-design-value', file, `${v.line}:${v.value}`)
      findings.push({
        id: `DSG-${fp.slice(0, 8)}`, fingerprint: fp, category: 'design', rule: 'hardcoded-design-value', severity: 'low', confidence: 'confirmed', path: file, line: v.line,
        evidence: v.value, explanation: explain(v, tokens).replace(/^- /, ''), remediation: 'Use the design token named above, or mark the line guardrail-ignore.', validation: `scan against ${tokensFile}`, disposition: 'open',
      })
    }
  }
  const check: CheckResult = {
    name: 'tokens',
    status: findings.length > 0 ? 'FAIL' : 'PASS',
    summary: `${findings.length} hardcoded value(s) in ${files.length} UI files, against ${tokensFile} (${tokens.length} tokens)`,
    findings,
    required,
  }
  return { gate: 'design', status: gateStatus([check]), checks: [check] }
}

// ---- accessibility ----------------------------------------------------------------------------

const A11Y_FILES = /\.(html|css|tsx|jsx|vue)$/
const COMPONENT = /\.(tsx|jsx|vue)$/
const PREFIXES = ['jsx-a11y/', 'vuejs-accessibility/']

function a11yFinding(file: string, f: A11yFinding): Finding {
  const fp = fingerprint(f.rule, file, `${f.line ?? ''}:${f.message}`)
  return {
    id: `A11Y-${fp.slice(0, 8)}`, fingerprint: fp, category: 'accessibility', rule: f.rule, severity: 'medium', confidence: f.rule.startsWith('axe/') || f.rule.startsWith('wcag/') ? 'confirmed' : 'likely',
    path: file, line: f.line, evidence: f.message, explanation: 'Automated WCAG 2.2 AA check failure.', remediation: 'See the rule documentation and fix the element named.', validation: f.rule.split('/')[0] ?? '', disposition: 'open',
  }
}

export function accessibilityGate(dir: string, config: ModspackConfig): GateResult {
  const files = sourceFiles(dir, config.exclude).files.filter(f => A11Y_FILES.test(f) && !/\.(test|spec|stories)\./.test(f) && (config.accessibility.paths === undefined || matchesAny(f, config.accessibility.paths)))
  if (files.length === 0) return { gate: 'accessibility', status: 'SKIPPED', checks: [notApplicable('ui-files', 'no HTML, CSS or component files')] }
  const required = config.accessibility.required
  const checks: CheckResult[] = []
  const texts = new Map<string, string>()
  for (const file of files) {
    const read = readText(path.join(dir, file))
    if ('text' in read) texts.set(file, read.text)
  }

  const contrast: Finding[] = []
  for (const [file, text] of texts) contrast.push(...contrastFindings(checkContrast(text)).map(f => a11yFinding(file, f)))
  checks.push({ name: 'contrast', status: contrast.length > 0 ? 'FAIL' : 'PASS', summary: `text contrast (WCAG 1.4.3) over ${texts.size} files: ${contrast.length} failure(s). Checks literal color pairs only.`, findings: contrast, required: true })

  const html = files.filter(f => f.endsWith('.html'))
  if (html.length === 0) checks.push(notApplicable('axe-core', 'no HTML files'))
  else {
    const found: Finding[] = []
    let failure: string | undefined
    for (const file of html) {
      const ran = spawnSync(process.execPath, [path.join(PACKAGE_ROOT, 'mods/wcag-enforcer/scripts/axe-check.mjs'), path.join(dir, file)], { cwd: dir, encoding: 'utf8', timeout: 60_000 })
      const parsed = parseAxe(ran.stdout ?? '')
      if (Array.isArray(parsed)) found.push(...parsed.map(f => a11yFinding(file, f)))
      else {
        failure = parsed.reason
        break
      }
    }
    checks.push(failure !== undefined
      ? { name: 'axe-core', status: required ? 'BLOCKED' : 'SKIPPED', summary: `${failure}${required ? '' : ' (set accessibility.required to make this BLOCKED instead of SKIPPED)'}`, required }
      : { name: 'axe-core', status: found.length > 0 ? 'FAIL' : 'PASS', summary: `axe-core over ${html.length} HTML file(s): ${found.length} violation(s)`, findings: found, required: true })
  }

  const components = files.filter(f => COMPONENT.test(f))
  if (components.length === 0) checks.push(notApplicable('eslint-a11y', 'no component files'))
  else {
    const eslint = path.join(dir, 'node_modules/.bin/eslint')
    if (!existsSync(eslint)) checks.push({ name: 'eslint-a11y', status: required ? 'BLOCKED' : 'SKIPPED', summary: 'ESLint is not installed in the project', required })
    else {
      const printed = spawnSync(eslint, ['--print-config', components[0]!], { cwd: dir, encoding: 'utf8', timeout: 60_000 })
      if (printed.status !== 0 || !hasA11yRules(printed.stdout, PREFIXES)) {
        checks.push({ name: 'eslint-a11y', status: required ? 'BLOCKED' : 'SKIPPED', summary: `the project's ESLint config turns on no ${PREFIXES.join(' or ')} rules (add eslint-plugin-jsx-a11y)`, required })
      } else {
        const ran = spawnSync(eslint, ['--format', 'json', ...components], { cwd: dir, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024 })
        const parsed = parseEslint(ran.stdout ?? '', PREFIXES)
        if (!Array.isArray(parsed)) checks.push({ name: 'eslint-a11y', status: required ? 'BLOCKED' : 'SKIPPED', summary: parsed.reason, required })
        else {
          let results: { filePath: string; messages: { ruleId?: string; line?: number; message?: string }[] }[] = []
          try { results = JSON.parse(ran.stdout) } catch { results = [] }
          const found = results.flatMap(r => r.messages.filter(m => typeof m.ruleId === 'string' && PREFIXES.some(p => m.ruleId!.startsWith(p))).map(m => a11yFinding(path.relative(dir, r.filePath), { rule: m.ruleId!, line: m.line, message: m.message ?? '' })))
          checks.push({ name: 'eslint-a11y', status: found.length > 0 ? 'FAIL' : 'PASS', summary: `jsx-a11y over ${components.length} component file(s): ${found.length} failure(s)`, findings: found, required: true })
        }
      }
    }
  }

  checks.push({
    name: 'manual-checks',
    status: 'NOT_TESTED',
    summary: 'keyboard operation, focus order, screen reader output, zoom/reflow and reduced motion are not tested by any automated check; use the wcag-audit skill checklist',
    required: false,
  })
  return { gate: 'accessibility', status: gateStatus(checks), checks }
}

// ---- package ----------------------------------------------------------------------------------

export function packageGate(dir: string): GateResult {
  const pkg = readPackage(dir)
  if (pkg === undefined) return { gate: 'package', status: 'SKIPPED', checks: [notApplicable('manifest', 'no package.json')] }
  if (pkg.private === true) return { gate: 'package', status: 'SKIPPED', checks: [notApplicable('manifest', 'private package, never published')] }
  const checks: CheckResult[] = []
  const problems: string[] = []
  for (const key of ['name', 'version', 'license', 'description']) if (typeof pkg[key] !== 'string' || pkg[key] === '') problems.push(`package.json has no ${key}`)
  if (typeof pkg.version === 'string' && !/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(pkg.version)) problems.push(`version "${pkg.version}" is not semver`)
  const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values((pkg.bin ?? {}) as Record<string, string>)
  const entries = [pkg.main, pkg.module, ...(typeof pkg.exports === 'string' ? [pkg.exports] : [])].filter((x): x is string => typeof x === 'string')
  for (const target of [...bins, ...entries]) if (!existsSync(path.join(dir, target))) problems.push(`${target} does not exist (build first?)`)
  checks.push({ name: 'manifest', status: problems.length > 0 ? 'FAIL' : 'PASS', summary: problems.length > 0 ? problems.join('; ') : `${pkg.name}@${pkg.version}: manifest fields, bin and entry points present`, required: true })

  const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 })
  let list: { files?: { path: string; size: number }[]; size?: number; unpackedSize?: number }[] | undefined
  try { list = JSON.parse(packed.stdout) } catch { list = undefined }
  if (list?.[0]?.files === undefined) {
    checks.push({ name: 'contents', status: 'BLOCKED', summary: `npm pack --dry-run did not return a file list (exit ${packed.status})`, required: true, command: 'npm pack --dry-run --json' })
  } else {
    const files = list[0].files.map(f => f.path)
    const bad = files.filter(f => /(^|\/)\.env(\.|$)|\.(pem|key|p12|pfx)$|(^|\/)(id_rsa|\.npmrc)$/.test(f))
    const missingLicense = !files.some(f => /^licen[cs]e/i.test(f))
    checks.push({
      name: 'contents',
      status: bad.length > 0 || missingLicense ? 'FAIL' : 'PASS',
      summary: bad.length > 0 ? `the package would ship files that should not be public: ${bad.slice(0, 6).join(', ')}` : missingLicense ? 'no LICENSE file would be included in the package' : `${files.length} files, ${((list[0].unpackedSize ?? 0) / 1024).toFixed(0)} kB unpacked`,
      required: true,
      command: 'npm pack --dry-run --json',
    })
  }
  return { gate: 'package', status: gateStatus(checks), checks }
}
