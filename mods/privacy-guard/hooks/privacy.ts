// What counts as personal or health data in source, and how sure we are.
// Pure functions, shared with the modspack CLI (which imports this file), so
// the Claude Code mod and CI apply the same rules.
//
// Detection is context-aware on purpose. An email address alone is not a
// privacy problem; an email beside a diagnosis is. Known test values (the
// 4242... card, 555-01xx phone numbers, example.com) are reported as
// synthetic, never as exposures.

export type PrivacyKind =
  | 'email'
  | 'phone'
  | 'us-ssn'
  | 'payment-card'
  | 'iban'
  | 'date-of-birth'
  | 'government-id'
  | 'medical-record-number'
  | 'health-insurance-id'
  | 'phi-record'
  | 'sensitive-record'

export type PrivacySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type PrivacyConfidence = 'confirmed' | 'likely' | 'possible'

export type PrivacyHit = {
  kind: PrivacyKind
  category: 'pii' | 'phi'
  severity: PrivacySeverity
  confidence: PrivacyConfidence
  /** 1-based line in the scanned text. */
  line: number
  /** The matched value. Callers must mask it before showing it anywhere. */
  value: string
  synthetic: boolean
  reason: string
}

export type PrivacyOptions = {
  /** Addresses and numbers that are meant to be public (support@, a press line). */
  publicContacts?: readonly string[]
  /** Email domains never flagged, beyond the reserved example and test domains. */
  allowDomains?: readonly string[]
  /** Treat the text as test data or a fixture: real-looking values drop one severity step and are flagged for review. */
  isFixture?: boolean
}

const IGNORE = /(privacy|guardrail)-ignore/

const RESERVED_DOMAINS = /(^|\.)(example\.(com|org|net)|test|invalid|localhost|example)$/i
const EMAIL = /(?<![\w.+-])[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24})(?![\w-])/g
// Role addresses published on purpose.
const ROLE_LOCAL = /^(support|help|info|contact|hello|admin|security|privacy|press|sales|noreply|no-reply|donotreply|team|legal|abuse|webmaster|postmaster|hi)$/i

const SSN = /(?<![\d-])(\d{3})-(\d{2})-(\d{4})(?![\d-])/g
const SSN_CONTEXT = /\b(ssn|social[\s_-]*security|tax[\s_-]*id|tin)\b/i
const KNOWN_FAKE_SSN = new Set(['123-45-6789', '078-05-1120', '219-09-9999', '111-11-1111', '000-00-0000'])

const CARD = /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g
const TEST_CARDS = new Set([
  '4242424242424242', '4111111111111111', '4000056655665556', '5555555555554444', '5105105105105100',
  '2223003122003222', '378282246310005', '371449635398431', '6011111111111117', '3056930009020004',
  '36227206271667', '3566002020360505', '6200000000000005', '4012888888881881', '5200828282828210',
])

const PHONE = /(?<![\w+])(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?![\w])/g
const PHONE_CONTEXT = /\b(phone|tel|mobile|cell|fax|contact)\b/i

const IBAN = /\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?)\b/g
const DOB = /\b(dob|date[\s_-]*of[\s_-]*birth|birth[\s_-]*date|birthday)\b["']?\s*[:=]?\s*["']?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/gi
const GOV_ID = /\b(passport|driver'?s?[\s_-]*licen[cs]e|dl[\s_-]*number|national[\s_-]*id)\b["']?\s*(?:no\.?|number|#)?\s*[:=]\s*["']?([A-Z0-9]{6,12})\b/gi
const MRN = /\b(mrn|medical[\s_-]*record[\s_-]*(?:number|no|#)?)\b["']?\s*[:=#]?\s*["']?([A-Z0-9-]{5,20})\b/gi
// Medicare Beneficiary Identifier, and labelled member/policy numbers.
const MBI = /\b[1-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d-?[AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d-?[AC-HJKMNP-RT-Y]{2}\d{2}\b/g
const INSURANCE = /\b(member[\s_-]*id|policy[\s_-]*(?:number|no)|subscriber[\s_-]*id|insurance[\s_-]*id|group[\s_-]*number)\b["']?\s*[:=#]\s*["']?([A-Z0-9-]{6,20})\b/gi

// Health and sensitive attributes count only as fields of a record (`"diagnosis": ...`, `condition: ...`),
// so prose that merely mentions a diagnosis is not mistaken for a record about someone.
const HEALTH_FIELD = /\b(diagnos[ie]s|diagnosis[\s_-]*code|icd[\s_-]*10(?:[\s_-]*code)?|icd|conditions?|medications?|prescriptions?|treatments?|allerg(?:y|ies)|lab[\s_-]*results?|blood[\s_-]*type|procedure[\s_-]*code|cpt)\b["']?\s*[:=]/i
const SENSITIVE_FIELD = /\b(salary|income|religion|ethnicity|sexual[\s_-]*orientation|criminal[\s_-]*record|immigration[\s_-]*status|credit[\s_-]*score)\b["']?\s*[:=]/i
const NAME_FIELD = /\b(full[\s_-]*name|first[\s_-]*name|last[\s_-]*name|patient[\s_-]*name|name)\b["']?\s*[:=]\s*["']([A-Z][a-z]+(?: [A-Z][a-z]+)+)["']/

const luhn = (digits: string) => {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i])
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

const ibanValid = (iban: string) => {
  const compact = iban.replace(/ /g, '')
  if (compact.length < 15 || compact.length > 34) return false
  const moved = compact.slice(4) + compact.slice(0, 4)
  let remainder = 0
  for (const ch of moved) {
    const value = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

const ssnValid = (area: string, group: string, serial: string) =>
  area !== '000' && area !== '666' && !area.startsWith('9') && group !== '00' && serial !== '0000'

const STEP_DOWN: Record<PrivacySeverity, PrivacySeverity> = { critical: 'high', high: 'medium', medium: 'low', low: 'info', info: 'info' }

/** Every likely piece of personal or health data in `text`. */
export function findPrivacy(text: string, options: PrivacyOptions = {}): PrivacyHit[] {
  const contacts = (options.publicContacts ?? []).map(c => c.trim().toLowerCase())
  const publicEmails = new Set(contacts.filter(c => c.includes('@')))
  const digitsOf = (value: string) => value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  const publicPhones = new Set(contacts.filter(c => !c.includes('@')).map(digitsOf))
  const allowDomains = (options.allowDomains ?? []).map(d => d.toLowerCase())
  const hits: PrivacyHit[] = []
  const lines = text.split('\n')

  lines.forEach((line, index) => {
    if (IGNORE.test(line)) return
    const lineNo = index + 1
    // A record is the line and its neighbours: enough to see a name beside a diagnosis in JSON or CSV.
    const record = lines.slice(Math.max(0, index - 3), index + 4).join('\n')
    const add = (hit: Omit<PrivacyHit, 'line'>) => {
      const adjusted = options.isFixture && !hit.synthetic && hit.severity !== 'info'
        ? { ...hit, severity: STEP_DOWN[hit.severity], confidence: 'possible' as const, reason: `${hit.reason} (in test data: confirm it is synthetic)` }
        : hit
      hits.push({ ...adjusted, line: lineNo })
    }

    for (const match of line.matchAll(EMAIL)) {
      const value = match[0]
      const domain = (match[1] ?? '').toLowerCase()
      const local = value.split('@')[0] ?? ''
      if (RESERVED_DOMAINS.test(domain) || allowDomains.some(d => domain === d || domain.endsWith(`.${d}`))) continue
      if (publicEmails.has(value.toLowerCase())) continue
      // Package and git noise: user@1.2.3, git@github.com
      if (/^\d/.test(domain) || /^git$/i.test(local)) continue
      const linked = HEALTH_FIELD.test(record) || SENSITIVE_FIELD.test(record)
      add({
        kind: 'email',
        category: 'pii',
        severity: linked ? 'medium' : ROLE_LOCAL.test(local) ? 'info' : 'low',
        confidence: linked ? 'likely' : 'possible',
        value,
        synthetic: false,
        reason: linked ? 'email address beside health or sensitive attributes' : ROLE_LOCAL.test(local) ? 'role address, usually public on purpose' : 'personal email address; fine if it is meant to be public',
      })
    }

    for (const match of line.matchAll(SSN)) {
      const value = match[0]
      const fake = KNOWN_FAKE_SSN.has(value) || !ssnValid(match[1] ?? '', match[2] ?? '', match[3] ?? '')
      const context = SSN_CONTEXT.test(record)
      if (!context && fake) continue
      add({
        kind: 'us-ssn',
        category: 'pii',
        severity: fake ? 'info' : context ? 'high' : 'medium',
        confidence: fake ? 'possible' : context ? 'confirmed' : 'likely',
        value,
        synthetic: fake,
        reason: fake ? 'SSN-shaped value that is a known example or invalid' : context ? 'valid-format Social Security number labelled as one' : 'valid-format Social Security number without a label',
      })
    }

    for (const match of line.matchAll(CARD)) {
      const digits = match[0].replace(/[ -]/g, '')
      if (digits.length < 13 || digits.length > 19 || !luhn(digits) || /^(\d)\1+$/.test(digits)) continue
      // Card numbers start 2-6; long numeric ids (timestamps, snowflakes) usually don't pass with a brand prefix.
      if (!/^(4|5[1-5]|2[2-7]|3[47]|3[068]|6)/.test(digits)) continue
      const test = TEST_CARDS.has(digits)
      add({
        kind: 'payment-card',
        category: 'pii',
        severity: test ? 'info' : 'high',
        confidence: test ? 'confirmed' : /\b(card|cc|pan|visa|mastercard|amex|payment)\b/i.test(record) ? 'confirmed' : 'likely',
        value: digits,
        synthetic: test,
        reason: test ? 'a published payment-processor test card' : 'Luhn-valid payment card number',
      })
    }

    if (PHONE_CONTEXT.test(line)) {
      for (const match of line.matchAll(PHONE)) {
        const value = match[0]
        const fictional = match[2] === '555' && /^01\d\d$/.test(match[3] ?? '')
        if (publicPhones.has(digitsOf(value))) continue
        add({
          kind: 'phone',
          category: 'pii',
          severity: fictional ? 'info' : 'low',
          confidence: 'possible',
          value,
          synthetic: fictional,
          reason: fictional ? '555-01xx is reserved for fiction' : 'phone number; fine if it is meant to be public',
        })
      }
    }

    for (const match of line.matchAll(IBAN)) {
      const value = match[1] ?? ''
      if (!ibanValid(value)) continue
      const example = /^(GB82WEST12345698765432|DE89370400440532013000)$/.test(value.replace(/ /g, ''))
      add({ kind: 'iban', category: 'pii', severity: example ? 'info' : 'high', confidence: example ? 'possible' : 'confirmed', value, synthetic: example, reason: example ? 'the IBAN registry example' : 'checksum-valid bank account number (IBAN)' })
    }

    for (const match of line.matchAll(DOB)) {
      add({ kind: 'date-of-birth', category: 'pii', severity: 'medium', confidence: 'likely', value: match[2] ?? '', synthetic: false, reason: 'labelled date of birth' })
    }
    for (const match of line.matchAll(GOV_ID)) {
      add({ kind: 'government-id', category: 'pii', severity: 'high', confidence: 'likely', value: match[2] ?? '', synthetic: false, reason: `labelled ${(match[1] ?? '').toLowerCase()} number` })
    }
    for (const match of line.matchAll(MRN)) {
      if (!/\d/.test(match[2] ?? '')) continue
      add({ kind: 'medical-record-number', category: 'phi', severity: 'high', confidence: 'likely', value: match[2] ?? '', synthetic: false, reason: 'labelled medical record number' })
    }
    for (const match of line.matchAll(MBI)) {
      add({ kind: 'health-insurance-id', category: 'phi', severity: 'high', confidence: 'likely', value: match[0], synthetic: false, reason: 'Medicare Beneficiary Identifier format' })
    }
    for (const match of line.matchAll(INSURANCE)) {
      if (!/\d/.test(match[2] ?? '')) continue
      add({ kind: 'health-insurance-id', category: 'phi', severity: 'medium', confidence: 'possible', value: match[2] ?? '', synthetic: false, reason: `labelled ${(match[1] ?? '').toLowerCase()}` })
    }

    // A name beside health information (or sensitive attributes) is a record about a person.
    const name = NAME_FIELD.exec(line)
    if (name !== null) {
      if (HEALTH_FIELD.test(record)) {
        add({ kind: 'phi-record', category: 'phi', severity: 'high', confidence: 'likely', value: name[2] ?? '', synthetic: false, reason: 'a named person beside diagnosis or treatment details' })
      } else if (SENSITIVE_FIELD.test(record)) {
        add({ kind: 'sensitive-record', category: 'pii', severity: 'medium', confidence: 'possible', value: name[2] ?? '', synthetic: false, reason: 'a named person beside sensitive attributes' })
      }
    }
  })
  return hits
}

/** Hits the edit adds: ones whose value the text already had are not the edit's doing. */
export function newHits(after: readonly PrivacyHit[], before: readonly PrivacyHit[]): PrivacyHit[] {
  const seen = new Map<string, number>()
  for (const hit of before) seen.set(`${hit.kind}:${hit.value}`, (seen.get(`${hit.kind}:${hit.value}`) ?? 0) + 1)
  return after.filter(hit => {
    const key = `${hit.kind}:${hit.value}`
    const left = seen.get(key) ?? 0
    if (left === 0) return true
    seen.set(key, left - 1)
    return false
  })
}

/** Paths that hold test data, where real-looking values most likely are synthetic but still need a look. */
export const isFixturePath = (path: string) =>
  /(^|[\\/])(tests?|__tests__|spec|fixtures?|__fixtures__|mocks?|__mocks__|seed|seeds|testdata|examples?)([\\/]|$)|\.(test|spec|fixture|mock)\.[a-z]+$/i.test(path)

/** A value shown to a person: never the value itself. */
export const maskValue = (hit: Pick<PrivacyHit, 'kind' | 'value'>) => `[${hit.kind}, ${hit.value.length} chars]`

/** Signals that a project handles regulated health information, for the HIPAA-related review. */
export const HEALTH_SIGNALS = /\b(fhir|hl7|hipaa|ehr|emr|phi|patient|diagnos[ie]s|icd-?10|cpt[\s_-]*code|npi|medicare|medicaid|epic|cerner|dicom|telehealth|ePHI)\b/i
