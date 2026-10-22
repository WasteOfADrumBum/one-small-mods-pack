---
name: release-readiness
description: Evaluates whether a project is ready to release and produces one READY or NOT READY verdict backed by evidence. Use when asked "is this ready to ship", to find release blockers, to define release acceptance criteria, or to consolidate QA, security, accessibility and packaging results.
license: MIT
metadata:
  modspack-category: release
  modspack-agent: release-manager
---

# Release readiness

Decide, on evidence, whether the agreed release scope is done. Never on how much code exists.

## When to use

- Before tagging, publishing or deploying.
- When the user asks what blocks a release, or whether one is ready.
- At the end of a phase of work, to check its acceptance criteria.

## Prerequisites

- The project builds and its tests can run locally (or the gaps are known).
- `npx modspack` is available (the package is `one-small-modspack`); without it, run the project's own checks and record each by hand.

## Inputs

- The release scope: what ships, for whom. If nobody wrote it down, infer it from the README, open issues and recent commits, and state your reading.
- `modspack.config.json`, if present (required gates, severity threshold).
- Results from specialist reviews, if any were run.

## Steps

1. Write the scope and the acceptance criteria as a numbered list. Each criterion must be checkable by a command or a named manual test.
2. Run `npx modspack release-check --json` and keep the JSON. It runs the quality, security, privacy, accessibility and package gates.
3. For every criterion the gates do not cover, find or run the check that proves it. Record command and output.
4. Classify each open issue:
   - **Release blocker**: stops the agreed release working, meeting its security requirements or its acceptance criteria.
   - **Post-release maintenance**: matters, does not block.
   - **Optional enhancement**: beyond the agreed scope. Not done now.
5. Apply the verdict rule: READY only if every mandatory gate and criterion is PASS. Any FAIL, BLOCKED, PARTIAL or NOT TESTED on a mandatory item means NOT READY.
6. Fill in [the report template](assets/report-template.md).

## Outputs

The release readiness report from the template: scope, criteria with status and evidence, gate results, blockers with the minimum steps to clear them, deferred items, and one verdict.

## Verification

- Every PASS cites a command and its result, or a named manual test with who ran it.
- The verdict line matches the rule in step 5.
- `npx modspack release-check` exit code agrees with the verdict (0 READY, non-zero NOT READY).

## Safety

- Read-only. Do not fix things while assessing them; list them.
- Never mark a check passed because its tool is missing.
- Never publish, deploy, merge or tag as part of this skill.

## Limitations

- Only as complete as the acceptance criteria. Unstated requirements are not checked.
- Legal or regulatory readiness needs qualified review; record it as NOT ASSESSED.
