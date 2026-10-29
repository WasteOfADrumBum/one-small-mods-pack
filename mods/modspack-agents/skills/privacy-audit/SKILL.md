---
name: privacy-audit
description: Detects and assesses personal data (PII) and health data (PHI) exposure in source, config, fixtures, logs, build output, public assets and git history, context-aware and masked, with a conditional HIPAA-related review that never claims compliance. Use for privacy, PII, PHI or HIPAA-related reviews, before releases that touch user data, or when adding analytics, logging or AI data flows.
license: MIT
metadata:
  modspack-category: privacy
  modspack-agent: security-privacy-auditor
---

# Privacy audit

Find personal and health data where it should not be, judge it in context, and report it without repeating it.

## When to use

- Before a release, for the privacy gate.
- When the project starts collecting, storing, logging or sending personal or health data.
- When asked about PII, PHI or HIPAA.

## Prerequisites

- A local checkout. `npx modspack privacy` needs nothing else.

## Inputs

- `modspack.config.json` privacy settings: `hipaa` (auto, on, off), `publicContacts`, `allowDomains`, and `exclude`.
- What data the product is meant to handle, if known.

## Steps

1. Run `npx modspack privacy --json`. It scans source, config, fixtures, logs, `public/` and build output for SSNs, payment cards (Luhn), IBANs (checksum), labelled dates of birth and government ids, medical record and insurance numbers, and named people beside diagnoses. Known test values are reported as synthetic.
2. Judge each finding in context:
   - Public on purpose (a support address on the contact page): add it to `privacy.publicContacts`.
   - Synthetic test data: confirm it is fake; prefer reserved values (example.com, 555-01xx, published test cards).
   - Real data: a finding. Its severity depends on what it is and where it is served.
3. Trace data flows the scan cannot see: what the app collects, where it is stored, who can read it, what is logged, what goes to analytics or AI providers, how long it is kept.
4. If the report says the HIPAA-related review is active (health-data signals found, or `privacy.hipaa: "on"`), work through [the HIPAA safeguards reference](references/hipaa.md). Mark every organisational safeguard NOT ASSESSED unless the user provides evidence.
5. Record remediation: remove, replace with synthetic data, move to a protected store, minimise, or document as intended.

## Outputs

A privacy report: findings with id, kind, category (PII or PHI), severity, confidence, path and line, masked evidence, context judgement, remediation and release impact; the data-flow notes; the HIPAA-related section when active, with potential concerns and NOT ASSESSED items.

## Verification

- No report line contains a complete personal record or identifier; only kind and length.
- Every dismissed finding has a stated reason.
- `npx modspack privacy` exits 1 while a high or critical finding is open.

## Safety

- Never paste found personal data into messages, issues, commits or external tools.
- Never upload data to outside scanners without explicit authorization.
- Use synthetic data for every test.

## Limitations

- Pattern and context detection: it can miss free-text personal data and flag unusual formats.
- HIPAA applicability depends on legal and operational facts. Report potential compliance concerns, never compliance or certification.
- Git history is scanned for secrets by the security scan; personal data in history needs `--history` here and is bounded by `security.history.maxCommits`.
