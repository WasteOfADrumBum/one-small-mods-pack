---
name: test-and-verify
description: Runs a project's existing tests, fills gaps with new tests in the same style, and records reproducible evidence (command, commit, output). Use when asked to test something, check for regressions, prove a fix, add missing tests, or produce test evidence for a release.
license: MIT
metadata:
  modspack-category: quality
  modspack-agent: qa-engineer
---

# Test and verify

Show what works with commands anyone can rerun.

## When to use

- After a change, to prove it works and nothing regressed.
- Before a release, for the test-evidence gate.
- When a bug is fixed and needs a regression test.

## Prerequisites

- The project's dependencies are installed.
- Test commands discoverable from `package.json` scripts, the CI workflow, a Makefile, or the README.

## Inputs

- What to verify: a feature, a fix, a requirement list, or "everything".

## Steps

1. Find the test commands. `npx modspack check --json` lists which of lint, typecheck, spellcheck, test and build exist and runs them.
2. Run the suite before changing anything. Record pass, fail and skip counts and the commit (`git rev-parse HEAD`).
3. Map each requirement to the test that covers it. Unmapped requirements are gaps.
4. Write tests for the gaps with the existing runner and conventions: same folder layout, helpers and assertion style. Add no new framework without a reason the user accepts.
5. For a bug fix, show the regression test fails without the fix (stash or revert locally) and passes with it.
6. For UI, run the project's browser tests; if there are none, do a scripted smoke test with the tools present, or list manual steps.
7. Run the full suite again.

## Outputs

A test report: each command with status (PASS, FAIL, SKIPPED, BLOCKED), counts, failure output, tests added and what each covers, remaining gaps, and manual checks still needed.

## Verification

- Every claimed PASS has a command and output from this session.
- New tests fail when the behaviour they protect is broken.

## Safety

- Fixtures use synthetic data only: example.com addresses, 555-01xx phone numbers, published test card numbers, obviously fake names and ids. Never real personal data, health data or credentials.
- Do not edit product code to make a test pass; report the failure.
- Do not run tests against production services.

## Limitations

- A missing tool or script is BLOCKED, not passed.
- Device, browser and assistive-technology coverage is limited to what is installed.
