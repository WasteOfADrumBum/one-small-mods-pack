---
name: wcag-audit
description: Audits web UI against WCAG 2.2 AA with automated checks (axe-core, jsx-a11y, contrast) plus a manual checklist for keyboard, focus, screen readers, forms, motion, zoom and reflow. Use for accessibility or a11y reviews, WCAG audits, or before shipping UI changes.
license: MIT
compatibility: Automated checks need axe-core and jsdom (HTML) or eslint-plugin-jsx-a11y (components) in the project.
metadata:
  modspack-category: accessibility
  modspack-agent: accessibility-auditor
---

# WCAG 2.2 AA audit

Automated checks first, then the manual checks no tool can do, with honest status for each.

## When to use

- Before releasing any UI change.
- When the user asks whether something is accessible.

## Prerequisites

- A way to view the UI: a local build or dev server.
- For automated HTML checks, `axe-core` and `jsdom` in the project (`npm i -D axe-core jsdom`). For components, ESLint with `eslint-plugin-jsx-a11y` (or `eslint-plugin-vuejs-accessibility`).

## Inputs

- The screens or components in scope.
- `accessibility` settings in `modspack.config.json`, if any.

## Steps

1. Run `npx modspack accessibility --json`. It runs axe-core on HTML, the contrast check on CSS and inline styles, and ESLint a11y rules when configured. Missing tools are reported as SKIPPED or BLOCKED.
2. Work through [the manual checklist](references/manual-checklist.md) for each screen in scope. Record PASS, FAIL or NOT TESTED for every item.
3. For each failure, record the success criterion (for example 2.4.11 Focus Not Obscured), the element, steps to reproduce, the impact, and the fix.
4. List what could not be tested and why (no screen reader available, no touch device).

## Outputs

An accessibility report: automated results, the manual checklist with status per item, findings by success criterion with severity and fix, and the remaining verification gap stated plainly.

## Verification

- The automated run's command and output are included.
- Every manual item has a status; none is silently omitted.
- A finding names its WCAG success criterion.

## Safety

- Read-only. Run scans against local builds, not production, unless the user says otherwise.

## Limitations

- Automated tools catch only part of WCAG failures. Passing them is not conformance.
- Screen reader behaviour is NOT TESTED unless a real screen reader was used.
- This is not a legal compliance certification.
