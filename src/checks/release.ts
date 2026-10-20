// release-check: run the gates the project requires and give one verdict.
//
// READY only when every required gate passed on evidence. A required gate
// that failed, was blocked, was only partly verified, or was switched off is
// NOT READY; a gate that does not apply (no UI files, a private package) is
// reported as not applicable and does not count against the release.
import type { Gate, ModspackConfig } from '../core/config'
import type { CheckResult, GateResult, Status } from '../core/report'
import { privacyGate, securityGate } from './gates'
import type { ScanOptions } from './gates'
import { accessibilityGate, designGate, packageGate, qualityGate } from './project'

export type Verdict = {
  verdict: 'READY' | 'NOT READY'
  gates: GateResult[]
  required: Gate[]
  reasons: { gate: string; check: string; status: Status; why: string }[]
  steps: string[]
  needsHumanReview: string[]
}

const GATES: Gate[] = ['quality', 'security', 'privacy', 'accessibility', 'design', 'package']

const applicable = (check: CheckResult) => check.status === 'SKIPPED' && check.summary.startsWith('not applicable')

export function releaseCheck(dir: string, config: ModspackConfig, options: ScanOptions = {}): Verdict {
  const required = config.release.requiredGates
  const gates: GateResult[] = []
  const reasons: Verdict['reasons'] = []
  const needsHumanReview: string[] = []

  for (const name of GATES) {
    const isRequired = required.includes(name)
    const enabled = name === 'package' || config.guards[name as keyof ModspackConfig['guards']] !== false
    if (!enabled) {
      gates.push({ gate: name, status: isRequired ? 'BLOCKED' : 'SKIPPED', checks: [{ name: 'switched-off', status: isRequired ? 'BLOCKED' : 'SKIPPED', summary: isRequired ? `required by release.requiredGates but guards.${name} is false, so it is unverified` : `guards.${name} is false`, required: isRequired }] })
      if (isRequired) reasons.push({ gate: name, check: 'switched-off', status: 'BLOCKED', why: `guards.${name} is false but release.requiredGates includes ${name}: unverified` })
      continue
    }
    const gate: GateResult =
      name === 'quality' ? qualityGate(dir, config)
      : name === 'security' ? securityGate(dir, config, options)
      : name === 'privacy' ? privacyGate(dir, config, options)
      : name === 'accessibility' ? accessibilityGate(dir, config)
      : name === 'design' ? designGate(dir, config)
      : packageGate(dir)
    if (!isRequired) {
      // Reported, never counted against the release.
      gates.push({ gate: gate.gate, status: gate.status, checks: gate.checks.map(c => ({ ...c, required: false })) })
      continue
    }
    gates.push(gate)
    for (const check of gate.checks.filter(c => c.required)) {
      if (check.status === 'PASS' || applicable(check)) continue
      reasons.push({ gate: name, check: check.name, status: check.status, why: check.summary })
    }
    if (gate.checks.every(applicable)) continue
    for (const check of gate.checks) {
      if (check.status === 'NOT_TESTED') needsHumanReview.push(`${name}/${check.name}: ${check.summary}`)
      if (check.name === 'hipaa-related-review' && check.status === 'PARTIAL') needsHumanReview.push(`privacy/hipaa-related-review: ${check.summary}`)
    }
  }
  // A required check that is not PASS or not applicable keeps its gate from reading PASS.
  for (const gate of gates) {
    if (required.includes(gate.gate as Gate) && reasons.some(r => r.gate === gate.gate) && gate.status === 'PASS') gate.status = 'PARTIAL'
  }

  const steps = reasons.map(r => {
    if (r.status === 'FAIL') return `Fix ${r.gate}/${r.check}: ${r.why}`
    if (r.status === 'BLOCKED') return `Unblock ${r.gate}/${r.check}: ${r.why}`
    return `Verify ${r.gate}/${r.check}: ${r.why}`
  })
  return { verdict: reasons.length === 0 ? 'READY' : 'NOT READY', gates, required, reasons, steps, needsHumanReview }
}
