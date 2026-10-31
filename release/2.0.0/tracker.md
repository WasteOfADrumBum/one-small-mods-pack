# ModsPack 2.0.0 release execution tracker

Agent-maintained record of the release-completion work. Agent-reported; nothing here is a human
verification or an approval. Release approval belongs to Joshua Small.

## Current stage

Stage 8 (final validation) after the release-preparation PR. See "Exact next action".

## Release acceptance state

| State | Status |
|---|---|
| A. Implementation complete | Yes: all planned 2.0 functionality is on `main` (PR #3), plus release tooling (this work). |
| B. Automated verification complete | Yes, on the candidate below, once its CI is green (cli, mods, windows, site, node-compat x3). |
| C. Distribution ready | Yes, pending the owner's one-time npm and environment setup (`release/README.md`). |
| D. Manual acceptance pending | Yes: every row of `manual-acceptance.md` is PENDING. |
| E. Officially released | No. Nothing published, tagged or deployed. |

## Candidates

| Commit | What it is | Evidence |
|---|---|---|
| `c747cbd6a9c3baddf2adca42798cd05f9511cef1` | Original 2.0 candidate (PR #3 merge) | CI run 40893584352; 2026-10-30 audit; `docs/release-verification.md` passes 1–3 |
| `452238075c5ad95c48cb41531c301253b1e36afe` | `main` on 2026-10-31: adds the Engineering Hub continuity files only (no package change) | CI run 41204049102; 2026-10-31 pass in `docs/release-verification.md` |
| merge commit of the release-preparation PR | **Proposed release candidate.** Changes the package: docs and `catalog/compatibility.json` updated to current evidence, and `npmCli` finds npm in POSIX Node layouts (used only in tests and on Windows at run time). Adds CI jobs and release workflows, which do not ship. | CI on that commit; see the PR |

Why a new candidate: the shipped README, CHANGELOG and compatibility catalog in `c747cbd` say
Codex hook enforcement is wholly untested and give no live Claude Code guard evidence, which is
no longer accurate, and the release workflow needs `release/package-files.txt` at the candidate.
The earlier evidence stays attached to `c747cbd`.

## Completed work

- Stage 0: baseline. `main` 4522380 green; no open PRs, tags or releases; npm name E404.
- Stage 1: `npm ci`, `npm run check` (90 + 133), `site:check` (18 pages), audits (0), `npm pack`
  (82 files), packed-artifact smoke 40/40 on Node 20, 22 and 24.
- Stage 2: fail-closed scrubber tests; all five guards enforced live in Claude Code 2.1.316.
- Stage 3: discovery rechecked in Codex 0.166.0, Copilot CLI 1.0.105, Gemini CLI 0.66.0; catalog updated.
- Stage 4: Pages workflow (build by default; deploy gated) and the manual acceptance checklist.
- Stage 5: fail-closed npm release workflow with provenance, pinned file list, release notes, runbook.
- Stage 6: install docs no longer depend on publication state; limitations updated.

## Outstanding work

Owner only (see the final report for steps): manual accessibility checks, platform checks with
signed-in tools (or explicit deferral), npm account/environment setup, dry run, tag, publish,
GitHub release, website deployment, plugin icon artwork before any directory submission.

## Exact next action

Owner: complete `release/2.0.0/manual-acceptance.md` (or defer rows explicitly), then follow
`release/README.md` from "Release steps" with the proposed candidate.
