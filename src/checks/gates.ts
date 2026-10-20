// The security and privacy gates: run the scans, apply the project's
// dismissals, and decide each check's status from the severity policy.
//
// Policy: an open finding at or above security.failOn whose confidence is
// "confirmed" fails the gate; one whose confidence is "likely" also fails it,
// as "needs review", until it is dismissed or accepted in config. "possible"
// findings are listed and never fail a gate. Severity is never lowered to
// make a gate pass: dismissals are recorded with their reason.
import { spawnSync } from 'node:child_process'
import { spawnTool } from '../core/exec'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ModspackConfig } from '../core/config'
import { buildFiles, DEFAULT_EXCLUDES, isGitRepo, matchesAny, readText, sourceFiles } from '../core/files'
import { atLeast, gateStatus } from '../core/report'
import type { CheckResult, Finding, GateResult, Severity } from '../core/report'
import { clientEnvFindings, installScriptFindings, publicArtifactFindings, workflowFindings } from './exposure'
import { hipaaReview, privacyFindings, privacyHistoryFindings } from './privacy'
import type { HipaaReview } from './privacy'
import { fingerprint, historyFindings, secretFindings, trackedEnvFindings } from './secrets'

export type ScanOptions = { history?: boolean; auditDeps?: boolean }

/** Applies security.accepted: a false positive or an accepted risk keeps its severity and gains a disposition. */
export function applyDispositions(findings: Finding[], config: ModspackConfig): Finding[] {
  const accepted = new Map(config.security.accepted.map(a => [a.fingerprint, a]))
  return findings.map(f => {
    const entry = accepted.get(f.fingerprint)
    if (entry === undefined) return f
    // An accepted risk needs someone's name on it; without one it stays open.
    if (entry.kind === 'accepted-risk' && (entry.approvedBy ?? '').trim() === '') return { ...f, dispositionReason: 'accepted-risk entry has no approvedBy, so it stays open' }
    return { ...f, disposition: entry.kind ?? 'false-positive', dispositionReason: entry.reason }
  })
}

/** Open findings that fail the gate under the policy above. */
export function blockingFindings(findings: readonly Finding[], failOn: Severity): Finding[] {
  return findings.filter(f => f.disposition === 'open' && atLeast(f.severity, failOn) && f.confidence !== 'possible')
}

function judged(name: string, findings: Finding[], failOn: Severity, what: string, extra: Partial<CheckResult> = {}): CheckResult {
  const blocking = blockingFindings(findings, failOn)
  const confirmed = blocking.filter(f => f.confidence === 'confirmed').length
  const review = blocking.length - confirmed
  const summary =
    blocking.length === 0
      ? `${what}: ${findings.length === 0 ? 'nothing found' : `${findings.length} finding${findings.length === 1 ? '' : 's'} below ${failOn} or dismissed`}`
      : `${what}: ${[confirmed > 0 ? `${confirmed} confirmed` : '', review > 0 ? `${review} need review` : ''].filter(Boolean).join(', ')} at ${failOn} or above`
  return { name, status: blocking.length > 0 ? 'FAIL' : 'PASS', summary, findings, required: true, ...extra }
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>()
  return findings.filter(f => (seen.has(f.fingerprint) ? false : (seen.add(f.fingerprint), true)))
}

/** gitleaks, when installed. Runs locally with --redact; nothing is downloaded or uploaded. */
function gitleaks(dir: string): CheckResult {
  const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8', timeout: 10_000 })
  if (probe.error !== undefined || probe.status !== 0) return { name: 'gitleaks', status: 'SKIPPED', summary: 'gitleaks is not installed (optional; ModsPack never downloads it)', required: false }
  const out = mkdtempSync(path.join(tmpdir(), 'modspack-gitleaks-'))
  try {
    const report = path.join(out, 'report.json')
    const run = spawnSync('gitleaks', ['detect', '--source', dir, '--no-banner', '--redact', '--report-format', 'json', '--report-path', report, '--exit-code', '0'], { encoding: 'utf8', timeout: 300_000 })
    if (run.status !== 0 || !existsSync(report)) return { name: 'gitleaks', status: 'BLOCKED', summary: `gitleaks ${probe.stdout.trim()} failed to run`, required: false }
    const raw = JSON.parse(readFileSync(report, 'utf8')) as { RuleID: string; File: string; StartLine: number; Commit?: string; Fingerprint?: string }[]
    const findings: Finding[] = raw.map(r => {
      const fp = fingerprint(`gitleaks-${r.RuleID}`, r.File, r.Fingerprint ?? `${r.Commit}:${r.StartLine}`)
      return {
        id: `SEC-gitleaks-${fp.slice(0, 8)}`, fingerprint: fp, category: 'secrets', rule: `gitleaks:${r.RuleID}`, severity: 'high', confidence: 'likely',
        path: r.Commit ? `${r.Commit.slice(0, 10)}:${r.File}` : r.File, line: r.StartLine, evidence: `${r.RuleID} [redacted by gitleaks]`,
        explanation: 'gitleaks matched a secret rule.', remediation: 'Rotate the credential and remove it from the code and history.', validation: `gitleaks ${probe.stdout.trim()} --redact`, disposition: 'open',
      }
    })
    return { name: 'gitleaks', status: 'PASS', summary: `gitleaks ${probe.stdout.trim()}: ${findings.length} finding(s)`, findings, required: false, command: 'gitleaks detect --redact' }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/** npm audit, only when allowed: it sends the dependency list to the registry. */
function dependencyAudit(dir: string, enabled: boolean): CheckResult {
  if (!enabled) return { name: 'dependency-audit', status: 'SKIPPED', summary: 'off by default (it sends the dependency list to the registry); enable with --audit-deps or security.dependencyAudit', required: false }
  if (!existsSync(path.join(dir, 'package-lock.json'))) {
    const other = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'].find(f => existsSync(path.join(dir, f)))
    return { name: 'dependency-audit', status: 'BLOCKED', summary: other ? `${other} found; only npm audit is integrated, run your package manager's audit by hand` : 'no lockfile to audit', required: true }
  }
  const run = spawnTool('npm', ['audit', '--json', '--omit=dev'], { cwd: dir, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024 })
  let parsed: { vulnerabilities?: Record<string, { severity: Severity | 'moderate'; via: unknown[]; fixAvailable: unknown }> }
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    return { name: 'dependency-audit', status: 'BLOCKED', summary: `npm audit did not return JSON (exit ${run.status}); offline?`, required: true, command: 'npm audit --json --omit=dev' }
  }
  const findings: Finding[] = Object.entries(parsed.vulnerabilities ?? {}).map(([name, v]) => {
    const severity: Severity = v.severity === 'moderate' ? 'medium' : v.severity
    const fp = fingerprint('dependency-vulnerability', name, severity)
    return {
      id: `DEP-${name}-${fp.slice(0, 8)}`, fingerprint: fp, category: 'dependencies', rule: 'dependency-vulnerability', severity, confidence: 'likely', path: `package-lock.json (${name})`,
      evidence: `${name}: ${v.via.map(x => (typeof x === 'string' ? x : (x as { title?: string }).title ?? '')).filter(Boolean).slice(0, 2).join('; ')}`,
      explanation: 'A production dependency has a published advisory. Whether this project reaches the vulnerable code needs review.',
      remediation: v.fixAvailable ? 'Update to a fixed version (npm audit fix, then test).' : 'No fix published: assess exposure, replace the package, or accept the risk with approval.',
      validation: 'npm audit --omit=dev', disposition: 'open',
    }
  })
  return { name: 'dependency-audit', status: 'PASS', summary: `npm audit: ${findings.length} vulnerable package(s)`, findings, required: true, command: 'npm audit --json --omit=dev' }
}

export type SecurityGate = GateResult & { findings: Finding[] }

export function securityGate(dir: string, config: ModspackConfig, options: ScanOptions = {}): SecurityGate {
  const failOn = config.security.failOn
  const excluded = (f: string) => matchesAny(f, [...DEFAULT_EXCLUDES, ...config.exclude])
  const source = sourceFiles(dir, config.exclude)
  const build = buildFiles(dir, config.exclude)
  const checks: CheckResult[] = []

  // Secrets in the working tree.
  const tree: Finding[] = []
  let skipped = 0
  for (const file of source.files) {
    const read = readText(path.join(dir, file))
    if ('text' in read) tree.push(...secretFindings(read.text, file))
    else if (read.skipped !== 'binary') skipped += 1
  }
  tree.push(...trackedEnvFindings(source.source === 'git' ? source.files : []))
  const secrets = judged('secrets', applyDispositions(dedupe(tree), config), failOn, `secrets in ${source.files.length} files`, {
    details: [skipped > 0 ? `${skipped} file(s) over 1 MB or unreadable were not scanned` : '', source.truncated ? 'file limit reached: scan is partial' : ''].filter(Boolean),
  })
  if (secrets.status === 'PASS' && source.truncated) secrets.status = 'PARTIAL'
  checks.push(secrets)

  // Secrets in git history.
  if (!config.security.history.enabled || options.history === false) {
    checks.push({ name: 'secrets-history', status: 'SKIPPED', summary: 'history scan turned off in config', required: false })
  } else if (!isGitRepo(dir)) {
    checks.push({ name: 'secrets-history', status: 'SKIPPED', summary: 'not a git repository', required: false })
  } else {
    const history = historyFindings(dir, config.security.history.maxCommits, excluded)
    if (history.error !== undefined) checks.push({ name: 'secrets-history', status: 'BLOCKED', summary: history.error, required: true })
    else {
      // A secret still in the tree is reported there; history adds the ones that were removed but remain in git.
      const inTree = new Set(tree.map(f => f.fingerprint))
      const onlyHistory = dedupe(history.findings).filter(f => !inTree.has(f.fingerprint))
      const result = judged('secrets-history', applyDispositions(onlyHistory, config), failOn, `secrets added in the last ${history.commits} commit(s)`)
      if (history.shallow && result.status === 'PASS') {
        result.status = 'PARTIAL'
        result.summary += ' (shallow clone: older history not scanned)'
      }
      checks.push(result)
    }
  }

  checks.push(judged('ci-workflows', applyDispositions(workflowFindings(dir, source.files), config), failOn, 'GitHub Actions workflows'))
  const install = installScriptFindings(dir)
  checks.push(judged('install-scripts', applyDispositions(install.findings, config), failOn, install.checked ? 'install scripts (package-lock.json)' : 'install scripts (no package-lock.json; dependency scripts not checked)'))
  checks.push(judged('client-env', applyDispositions(clientEnvFindings(dir, source.files), config), failOn, 'client-exposed environment variables'))

  const builtSecrets: Finding[] = []
  for (const file of build.files.filter(f => !f.startsWith('public/'))) {
    const read = readText(path.join(dir, file))
    if ('text' in read) builtSecrets.push(...secretFindings(read.text, file, 'build-output'))
  }
  const exposure = [...publicArtifactFindings(dir, build.files), ...builtSecrets]
  checks.push(judged('build-output', applyDispositions(dedupe(exposure), config), failOn, build.files.length === 0 ? 'build output (none present; build first to check it)' : `build output (${build.files.length} files)`))

  if (config.security.externalScanners) checks.push(gitleaks(dir))
  checks.push(dependencyAudit(dir, options.auditDeps ?? config.security.dependencyAudit))

  const findings = checks.flatMap(c => c.findings ?? [])
  return { gate: 'security', status: gateStatus(checks), checks, findings }
}

export type PrivacyGate = GateResult & { findings: Finding[]; hipaa: HipaaReview }

export function privacyGate(dir: string, config: ModspackConfig, options: ScanOptions = {}): PrivacyGate {
  const failOn: Severity = 'high'
  const source = sourceFiles(dir, config.exclude)
  const build = buildFiles(dir, config.exclude)
  const checks: CheckResult[] = []

  const scan = privacyFindings(dir, source.files, config)
  const tree = applyDispositions(scan.findings, config)
  checks.push(judged('personal-data', tree, failOn, `personal and health data in ${scan.scanned} files`))

  const built = privacyFindings(dir, build.files.filter(f => !f.startsWith('public/')), config, 'privacy-build')
  checks.push(judged('build-output', applyDispositions(built.findings, config), failOn, build.files.length === 0 ? 'build output (none present)' : `build output (${built.scanned} files)`))

  if (options.history) {
    if (!isGitRepo(dir)) checks.push({ name: 'history', status: 'SKIPPED', summary: 'not a git repository', required: false })
    else checks.push(judged('history', applyDispositions(privacyHistoryFindings(dir, config.security.history.maxCommits, config), config), failOn, `personal data added in the last ${config.security.history.maxCommits} commits`))
  } else {
    checks.push({ name: 'history', status: 'SKIPPED', summary: 'git history not scanned for personal data (use --history)', required: false })
  }

  const phi = tree.filter(f => f.category.endsWith('-phi') && f.confidence !== 'possible')
  const hipaa = hipaaReview(dir, source.files, phi, config.privacy.hipaa)
  if (hipaa.active) {
    const concerns = hipaa.items.filter(i => i.status === 'POTENTIAL CONCERN').length
    checks.push({
      name: 'hipaa-related-review',
      // Potential concerns are for a person to weigh, so the review itself never passes or fails the gate.
      status: 'PARTIAL',
      summary: `active (${hipaa.reason}): ${concerns} potential concern(s), ${hipaa.items.filter(i => i.status === 'NOT ASSESSED').length} item(s) NOT ASSESSED`,
      details: hipaa.items.map(i => `${i.status}: ${i.area}. ${i.note}`),
      required: false,
    })
  } else {
    checks.push({ name: 'hipaa-related-review', status: 'SKIPPED', summary: `not active: ${hipaa.reason}`, required: false })
  }

  const findings = checks.flatMap(c => c.findings ?? [])
  return { gate: 'privacy', status: gateStatus(checks), checks, findings, hipaa }
}

