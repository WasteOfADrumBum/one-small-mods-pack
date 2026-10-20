# HIPAA-related review

Use only when the project may create, receive, store or transmit electronic protected health information (ePHI), or when configured with `privacy.hipaa: "on"`. Whether HIPAA applies depends on whether the organisation is a covered entity or business associate: a legal question, not a code question.

Report each item as POTENTIAL CONCERN, NO CONCERN FOUND, or NOT ASSESSED. Never as compliant.

## Technical safeguards (45 CFR 164.312), assessable in code

| Area | Look for |
|---|---|
| Access control | Unique user identities; role checks on every PHI read and write; automatic logoff; emergency access path. |
| Audit controls | Logs of who read or changed PHI and when, stored tamper-resistant, without the PHI itself in the log line. |
| Integrity | PHI changes validated and traceable; no silent overwrites. |
| Authentication | Strong authentication for PHI access; MFA for administrative access. |
| Transmission security | TLS for every PHI transfer, including internal services and webhooks; no PHI in URLs or query strings. |
| Encryption at rest | Database, backups, object storage and device caches encrypted; keys managed outside the code. |

## Data handling, assessable in code

- PHI never in logs, analytics events, error reports, client-side storage or URLs.
- PHI not sent to third parties (analytics, AI model providers, email services) without a business associate agreement in place (ask; mark NOT ASSESSED if unknown).
- Minimum necessary: endpoints return only the fields the screen needs.
- Retention and deletion paths exist.
- Test fixtures and seed data are synthetic.

## Administrative and physical safeguards, NOT ASSESSED by code review

Risk analysis, workforce training, sanctions policy, contingency and backup plans, facility and device controls, business associate agreements, breach notification procedures. List them as NOT ASSESSED and name who would need to confirm them.
