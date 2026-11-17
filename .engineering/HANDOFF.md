<!-- generated from .engineering/state.json (revision 3) -->

# Handoff: one-small-mods-pack

Read this, then **verify against GitHub** (branch head, open PRs, CI) before continuing. Nothing below is independently verified.

- Checkpoint: revision 3, `npm-release-failure-nov11`, 2026-11-17T02:24:38Z by cursor (grok-4.7)
- Written by: a local edit that the agent then pushed; confirm the branch head matches
- Uncommitted work outside this checkpoint: **none**

## Continue with

Read release/README.md section "2.0.0 publish outcome (2026-11-11)". The workflow file on main already contains the confirm-step fix. Do not publish, tag, or re-dispatch publish for 2.0.0. GitHub main was 065732f when this was written; the previous checkpoint recorded 26b5ccd. Trust GitHub if they differ.

## Unfinished

- Owner: trusted publisher for release.yml and environment npm-publish, then remove the one-day NPM_TOKEN, before the next version. This session cannot read secrets, so that setup is unverified.
- Manual acceptance rows remain DEFERRED-BY-OWNER. Do not call the package accessibility-verified.
- Codex interactive trust, Copilot and Gemini signed-in runtime remain unverified.

## Blockers

- Next npm publish needs an owner-side trusted publisher or a fresh publish token. An interactive npm one-time password cannot be completed in Actions (EOTP on attempt 2).

## Decisions

- [agent] Agent proposed b0ff54a (merge of PR #5) as the 2.0.0 package candidate. Main later moved to 26b5ccd (PRs #6, #7) without shipped-file changes; the release is cut from the owner's sign-off commit, whose tarball must equal b0ff54a's. Owner accepts by releasing.
- [agent] Node 20 support claim kept for the CLI runtime (smoke and 82 non-site tests pass); dev-only site tests need Node >=22.22.2 (jsdom 30) and are excluded on Node 20 in CI.
- [human] Owner postponed manual accessibility testing on 2026-10-29; nothing marked passed. (docs/release-verification.md, section "Scope decision (2026-10-29, owner)")
- [agent] Release-closure records go in non-shipped files (release/, ROADMAP.md, .engineering/) so the 2.0.0 tarball stays identical to the verified b0ff54a artifact; catalog update for Claude Code agent evidence is roadmap R3.
- [agent] The 2026-11-11 Release (npm) run failed after a successful upload because confirm waited about 60 seconds. Commit 6926801 on main already waits five minutes and warns. This change does not edit the workflow.

## Constraints

- npm publish, tags, GitHub releases, website deployment and release approval are owner actions.
- Website must not be deployed and the package must not be called accessibility-verified until manual accessibility checks are done.
- Do not mark manual or platform checks passed without a person running them.

## Unresolved decisions

- Ship with Codex interactive trust, Copilot and Gemini runtime unverified (rows P1-P3 DEFERRED-BY-OWNER) or test them first.
- Plugin icon artwork before any plugin directory submission (ROADMAP.md R1).
