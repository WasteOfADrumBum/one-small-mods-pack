// The words every check and report uses, so a result never reads as more
// than what was verified.
//   PASS     an executed check passed
//   FAIL     an executed check failed
//   PARTIAL  some of what was asked was verified
//   SKIPPED  deliberately not run (turned off, nothing to check)
//   BLOCKED  could not run (a tool or input is missing)
//   NOT_TESTED  no verification has happened
export type Status = 'PASS' | 'FAIL' | 'PARTIAL' | 'SKIPPED' | 'BLOCKED' | 'NOT_TESTED'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']
export const atLeast = (severity: Severity, threshold: Severity) => SEVERITY_ORDER.indexOf(severity) <= SEVERITY_ORDER.indexOf(threshold)

export type Confidence = 'confirmed' | 'likely' | 'possible'

export type Finding = {
  /** Stable for the same issue at the same place, so it can be accepted in config. */
  id: string
  fingerprint: string
  category: string
  rule: string
  severity: Severity
  confidence: Confidence
  path?: string
  line?: number
  /** Never the raw value: masked, or a description. */
  evidence: string
  explanation: string
  remediation: string
  validation: string
  /** open, false-positive or accepted-risk (from config). */
  disposition: 'open' | 'false-positive' | 'accepted-risk'
  dispositionReason?: string
}

export type CheckResult = {
  name: string
  status: Status
  /** One line on what ran, or why it didn't. */
  summary: string
  command?: string
  findings?: Finding[]
  details?: string[]
  /** Whether a FAIL or BLOCKED here fails the gate it belongs to. */
  required: boolean
}

export type GateResult = { gate: string; status: Status; checks: CheckResult[] }

/** Exit codes: stable, documented in the CLI reference. */
export const EXIT = { ok: 0, failed: 1, usage: 2, blocked: 3 } as const

/** A gate's status from its checks: any required FAIL fails it, any required BLOCKED blocks it. */
export function gateStatus(checks: readonly CheckResult[]): Status {
  const required = checks.filter(c => c.required)
  if (required.some(c => c.status === 'FAIL')) return 'FAIL'
  if (required.some(c => c.status === 'BLOCKED' || c.status === 'NOT_TESTED')) return 'BLOCKED'
  if (checks.length > 0 && checks.every(c => c.status === 'SKIPPED')) return 'SKIPPED'
  if (checks.some(c => c.status === 'PARTIAL' || (!c.required && (c.status === 'FAIL' || c.status === 'BLOCKED')))) return 'PARTIAL'
  return 'PASS'
}

/** The exit code for a set of gates in the given mode. Advisory never fails, but a required check that could not run still exits 3. */
export function exitCode(gates: readonly GateResult[], mode: 'enforce' | 'advisory'): number {
  if (gates.some(g => g.status === 'BLOCKED' || g.checks.some(c => c.required && (c.status === 'BLOCKED' || c.status === 'NOT_TESTED')))) return EXIT.blocked
  if (mode === 'enforce' && gates.some(g => g.status === 'FAIL')) return EXIT.failed
  return EXIT.ok
}

/** Masks a sensitive value completely: only its length survives. Correlate findings by fingerprint, never by value. */
export function mask(value: string): string {
  return `[masked, ${value.length} chars]`
}
