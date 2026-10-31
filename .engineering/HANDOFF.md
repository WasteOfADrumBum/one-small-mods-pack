<!-- generated from .engineering/state.json (revision 1) -->

# Handoff: one-small-mods-pack

Read this, then **verify against GitHub** (branch head, open PRs, CI) before continuing. Nothing below is independently verified.

- Checkpoint: revision 1, `rel-2-0-prep-b0ff54a`, 2026-10-31T19:46:44Z by claude-code
- Written by: a local edit that the agent then pushed; confirm the branch head matches
- Uncommitted work outside this checkpoint: **none**

## Continue with

Read release/2.0.0/tracker.md and release/README.md. No agent work remains before the owner acts; after the owner signs manual-acceptance.md, an agent can run the Release (npm) dry run and report.

## Unfinished

- Manual acceptance (release/2.0.0/manual-acceptance.md, 15 rows PENDING)
- npm publication, v2.0.0 tag, GitHub release, website deployment (owner)

## Blockers

- Manual accessibility acceptance (blocks website deploy and the publish gate)
- Owner authorization and npm account setup

## Decisions

- [agent] Agent proposes b0ff54a436c90dc02b59cde3a1fca5e94334bc4f (merge of PR #5) as the 2.0.0 candidate instead of c747cbd, because shipped docs and catalog changed to current evidence; c747cbd evidence stays attached to c747cbd. Owner must accept by releasing from it.
- [agent] Node 20 support claim kept for the CLI runtime (smoke and 82 non-site tests pass); dev-only site tests need Node >=22.22.2 (jsdom 30) and are excluded on Node 20 in CI.
- [human] Owner postponed manual accessibility testing on 2026-10-29; nothing marked passed. (docs/release-verification.md, section "Scope decision (2026-10-29, owner)")

## Constraints

- npm publish, tags, GitHub releases, website deployment and release approval are owner actions.
- Website must not be deployed and the package must not be called accessibility-verified until manual accessibility checks are done.
- Do not mark manual or platform checks passed without a person running them.

## Unresolved decisions

- Ship with Codex interactive trust, Copilot and Gemini runtime unverified (DEFERRED-BY-OWNER) or test them first.
- Plugin icon artwork before any plugin directory submission.
