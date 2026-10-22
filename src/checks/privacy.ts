// Personal and health data in the project, with privacy-guard's rules, and
// the conditional HIPAA-related review.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { findPrivacy, HEALTH_SIGNALS, isFixturePath, maskValue } from '../../mods/privacy-guard/hooks/privacy'
import type { PrivacyHit } from '../../mods/privacy-guard/hooks/privacy'
import type { ModspackConfig } from '../core/config'
import { readText } from '../core/files'
import type { Finding } from '../core/report'
import { fingerprint } from './secrets'

// Lock files, minified bundles, binary-ish text and docs about the rules themselves add noise, not exposure.
const SKIP = /\.(lock|min\.js|map|svg|snap)$|(^|\/)(CHANGELOG|LICENSE)(\.md)?$/i

export function hitToFinding(hit: PrivacyHit, where: string, category = 'privacy'): Finding {
  const fp = fingerprint(hit.kind, where, hit.value)
  return {
    id: `PRV-${hit.kind}-${fp.slice(0, 8)}`,
    fingerprint: fp,
    category: hit.category === 'phi' ? `${category}-phi` : category,
    rule: hit.kind,
    severity: hit.severity,
    confidence: hit.synthetic ? 'possible' : hit.confidence,
    path: where,
    line: hit.line,
    evidence: maskValue(hit),
    explanation: hit.synthetic ? `Synthetic value: ${hit.reason}.` : `${hit.category === 'phi' ? 'Possible health information' : 'Possible personal data'}: ${hit.reason}.`,
    remediation: hit.synthetic
      ? 'None needed.'
      : 'Remove it or replace it with clearly synthetic data. If it is meant to be public, list it under privacy.publicContacts or mark the line privacy-ignore. If the product stores this data, keep it in a protected store, not in source or served files.',
    validation: 'Pattern and context match; a person must confirm whether it is real.',
    disposition: 'open',
  }
}

export function privacyFindings(dir: string, files: readonly string[], config: ModspackConfig, category = 'privacy'): { findings: Finding[]; scanned: number; skipped: number } {
  const findings: Finding[] = []
  let scanned = 0
  let skipped = 0
  for (const file of files) {
    if (SKIP.test(file)) continue
    const read = readText(path.join(dir, file))
    if (!('text' in read)) {
      skipped += 1
      continue
    }
    scanned += 1
    const hits = findPrivacy(read.text, { publicContacts: config.privacy.publicContacts, allowDomains: config.privacy.allowDomains, isFixture: isFixturePath(file) })
    findings.push(...hits.map(hit => hitToFinding(hit, file, category)))
  }
  return { findings, scanned, skipped }
}

/** Personal data added in recent commits. */
export function privacyHistoryFindings(dir: string, maxCommits: number, config: ModspackConfig): Finding[] {
  let log: string
  try {
    log = execFileSync('git', ['log', '-p', '--no-color', '-U0', `-n${maxCommits}`, '--format=commit %H'], { cwd: dir, maxBuffer: 512 * 1024 * 1024, timeout: 120_000, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  } catch {
    return []
  }
  const findings: Finding[] = []
  let commit = ''
  let file = ''
  let added: string[] = []
  const flush = () => {
    if (file !== '' && added.length > 0 && !SKIP.test(file)) {
      for (const hit of findPrivacy(added.join('\n'), { publicContacts: config.privacy.publicContacts, allowDomains: config.privacy.allowDomains, isFixture: isFixturePath(file) })) {
        findings.push({ ...hitToFinding(hit, `${commit.slice(0, 10)}:${file}`, 'privacy-history'), line: undefined })
      }
    }
    added = []
  }
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) {
      flush()
      commit = line.slice(7)
      file = ''
    } else if (line.startsWith('+++ ')) {
      flush()
      file = line.startsWith('+++ b/') ? line.slice(6) : ''
    } else if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1))
  }
  flush()
  return findings
}

export type HipaaItem = { area: string; status: 'POTENTIAL CONCERN' | 'NO CONCERN FOUND' | 'NOT ASSESSED'; note: string }
export type HipaaReview = { active: boolean; reason: string; signals: string[]; items: HipaaItem[]; disclaimer: string }

const DISCLAIMER =
  'HIPAA applicability depends on legal and operational facts this scan cannot see. Items below are potential compliance concerns found in code, not a compliance determination or certification. Administrative and physical safeguards need people to assess.'

const ANALYTICS = /\b(@segment\/|mixpanel|@amplitude|posthog|@vercel\/analytics|react-ga|gtag|@google-analytics|hotjar|fullstory|logrocket|@sentry\/|datadog|newrelic)/
const AI_SDK = /\b(openai|@anthropic-ai\/sdk|@google\/genai|@google\/generative-ai|cohere-ai|@mistralai|ai\/rsc|@ai-sdk\/)/
const AUTH = /\b(next-auth|@auth\/|@clerk\/|@supabase\/auth|passport|@okta\/|auth0|firebase\/auth|lucia|better-auth|iron-session|jsonwebtoken|jose)\b/

/** The HIPAA-related review: on when configured, or in auto mode when the project shows health-data signals. */
export function hipaaReview(dir: string, files: readonly string[], phiFindings: readonly Finding[], mode: 'auto' | 'on' | 'off'): HipaaReview {
  const signals = new Set<string>()
  let deps = ''
  if (existsSync(path.join(dir, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>
      deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(' ')
      for (const match of deps.matchAll(new RegExp(HEALTH_SIGNALS.source, 'gi'))) signals.add(`dependency: ${match[0].toLowerCase()}`)
    } catch {
      // ignore
    }
  }
  let sourceHits = 0
  let logsPhi = false
  let insecureUrl = false
  let auditLog = false
  for (const file of files) {
    if (!/\.(m?[jt]sx?|py|rb|go|java|cs|php|prisma|sql|graphql)$/.test(file) || isFixturePath(file)) continue
    const read = readText(path.join(dir, file))
    if (!('text' in read)) continue
    // Health terms count where data is modelled (schemas, models, migrations), not in prose or in tools that merely talk about health data.
    const isModel = /\.(prisma|sql|graphql)$|(^|\/)(models?|schemas?|entities|migrations|db|database|types)\//i.test(file)
    const terms = isModel ? new Set([...read.text.matchAll(new RegExp(HEALTH_SIGNALS.source, 'gi'))].map(m => m[0].toLowerCase())) : new Set<string>()
    if (terms.size >= 2) {
      sourceHits += 1
      for (const term of terms) if (signals.size < 12) signals.add(`code: ${term}`)
    }
    if (/(console\.(log|info|debug)|logger\.\w+|log\.(info|debug))\([^)]*\b(patient|diagnos|ssn|dob|mrn|medical|insurance)/i.test(read.text)) logsPhi = true
    if (/["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])[\w.-]+/.test(read.text)) insecureUrl = true
    if (/audit[_-]?log|auditLog|AuditEvent|audit_trail/i.test(read.text)) auditLog = true
  }
  const active = mode === 'on' || (mode === 'auto' && (phiFindings.length > 0 || sourceHits >= 1 || [...signals].some(s => s.startsWith('dependency'))))
  const reason =
    mode === 'on' ? 'privacy.hipaa is "on"' : mode === 'off' ? 'privacy.hipaa is "off"' : active ? `health-data signals found (${phiFindings.length} PHI finding${phiFindings.length === 1 ? '' : 's'}, ${sourceHits} data model file${sourceHits === 1 ? '' : 's'} with health terms)` : 'no health-data signals found'
  if (!active) return { active, reason, signals: [...signals], items: [], disclaimer: DISCLAIMER }

  const items: HipaaItem[] = [
    { area: 'PHI in source and served files', status: phiFindings.length > 0 ? 'POTENTIAL CONCERN' : 'NO CONCERN FOUND', note: phiFindings.length > 0 ? `${phiFindings.length} possible PHI value(s); see the privacy findings.` : 'No PHI patterns found by the scan.' },
    { area: 'PHI in logs', status: logsPhi ? 'POTENTIAL CONCERN' : 'NO CONCERN FOUND', note: logsPhi ? 'A log call mentions patient, diagnosis, SSN, DOB, MRN, medical or insurance fields.' : 'No log call referencing health fields was found (pattern-based).' },
    { area: 'Transmission security', status: insecureUrl ? 'POTENTIAL CONCERN' : 'NOT ASSESSED', note: insecureUrl ? 'Plain http:// URLs to non-local hosts are in the code.' : 'No plain-http URLs found; TLS configuration of the deployment is not visible to a code scan.' },
    { area: 'Audit controls', status: auditLog ? 'NOT ASSESSED' : 'POTENTIAL CONCERN', note: auditLog ? 'Audit logging code exists; whether it covers every PHI read and write needs review.' : 'No audit logging code was found.' },
    { area: 'Access control and authentication', status: AUTH.test(deps) ? 'NOT ASSESSED' : 'POTENTIAL CONCERN', note: AUTH.test(deps) ? 'An authentication library is present; role checks on each PHI access need manual review.' : 'No known authentication library in dependencies.' },
    { area: 'Third parties receiving data', status: ANALYTICS.test(deps) || AI_SDK.test(deps) ? 'POTENTIAL CONCERN' : 'NO CONCERN FOUND', note: ANALYTICS.test(deps) || AI_SDK.test(deps) ? 'Analytics, error-tracking or AI SDKs are present. Confirm no PHI reaches them, or that a business associate agreement covers them.' : 'No analytics or AI SDKs in dependencies.' },
    { area: 'Encryption at rest', status: 'NOT ASSESSED', note: 'Depends on database, storage and backup configuration outside the code.' },
    { area: 'Retention and deletion', status: 'NOT ASSESSED', note: 'Needs the data lifecycle design.' },
    { area: 'Administrative safeguards (risk analysis, training, BAAs, incident response)', status: 'NOT ASSESSED', note: 'Organisational; cannot be assessed from code.' },
    { area: 'Physical safeguards', status: 'NOT ASSESSED', note: 'Organisational; cannot be assessed from code.' },
  ]
  return { active, reason, signals: [...signals], items, disclaimer: DISCLAIMER }
}
