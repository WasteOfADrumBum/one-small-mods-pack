<!-- generated from .engineering/state.json (revision 2) -->

# Handoff: one-small-mods-pack

Read this, then **verify against GitHub** (branch head, open PRs, CI) before continuing. Nothing below is independently verified.

- Checkpoint: revision 2, `rel-2-0-closeout-26b5ccd`, 2026-11-04T16:24:23Z by claude-code
- Written by: a local edit that the agent then pushed; confirm the branch head matches
- Uncommitted work outside this checkpoint: **none**

## Continue with

Read release/2.0.0/tracker.md and release/2.0.0/verification-2026-11-04.md. No agent work remains before the owner acts; after the owner signs manual-acceptance.md, an agent can run the Release (npm) dry run on the sign-off commit and report.

## Unfinished

- Manual acceptance (release/2.0.0/manual-acceptance.md, 15 rows PENDING, owner sign-off missing)
- npm account access check, npm-publish environment, first-publication token (owner)
- Release dry run on the sign-off commit, v2.0.0 tag, npm publish, GitHub release, Pages deploy (owner)

## Blockers

- Manual accessibility acceptance (blocks the publish gate and website deploy)
- Owner decision on rows P1-P3 (test or DEFERRED-BY-OWNER)
- Owner npm account access and environment setup; owner authorization

## Decisions

- [agent] Agent proposed b0ff54a (merge of PR #5) as the 2.0.0 package candidate. Main later moved to 26b5ccd (PRs #6, #7) without shipped-file changes; the release is cut from the owner's sign-off commit, whose tarball must equal b0ff54a's. Owner accepts by releasing.
- [agent] Node 20 support claim kept for the CLI runtime (smoke and 82 non-site tests pass); dev-only site tests need Node >=22.22.2 (jsdom 30) and are excluded on Node 20 in CI.
- [human] Owner postponed manual accessibility testing on 2026-10-29; nothing marked passed. (docs/release-verification.md, section "Scope decision (2026-10-29, owner)")
- [agent] Release-closure records go in non-shipped files (release/, ROADMAP.md, .engineering/) so the 2.0.0 tarball stays identical to the verified b0ff54a artifact; catalog update for Claude Code agent evidence is roadmap R3.

## Constraints

- npm publish, tags, GitHub releases, website deployment and release approval are owner actions.
- Website must not be deployed and the package must not be called accessibility-verified until manual accessibility checks are done.
- Do not mark manual or platform checks passed without a person running them.

## Unresolved decisions

- Ship with Codex interactive trust, Copilot and Gemini runtime unverified (rows P1-P3 DEFERRED-BY-OWNER) or test them first.
- Plugin icon artwork before any plugin directory submission (ROADMAP.md R1).
