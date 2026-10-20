---
name: release-and-freeze
description: Prepares the release handoff and the maintenance state after it - version bump, changelog, release notes, migration notes, rollback plan, known limitations and a maintenance checklist - leaving publish and deploy to the user. Use when a release is approved and needs packaging up, or when a project moves into maintenance.
license: MIT
metadata:
  modspack-category: release
  modspack-agent: release-engineer
---

# Release and freeze

Turn a verified release into a handoff a person can ship, then leave the project in a known, maintainable state.

## When to use

- The release-readiness verdict is READY and the user wants it prepared.
- A project is moving from active development to maintenance.

## Prerequisites

- A READY verdict from the `release-readiness` skill, or the user's explicit decision to prepare anyway.

## Inputs

- The version scheme the project uses (semver, calendar), and its changelog file.
- The changes since the last release: `git log <last-tag>..HEAD --oneline`.

## Steps

1. Choose the version: major for breaking changes, minor for features, patch for fixes. State the reason.
2. Update the version where the project keeps it (package.json, plugin manifests) and the changelog, in the existing format.
3. Write release notes from [the template](assets/release-notes.md): what changed, who is affected, how to upgrade, known limitations.
4. Write migration notes for each breaking change: what breaks, how to detect it, how to migrate.
5. Write the rollback plan: the previous version, the command to restore it, data or migration concerns, how to confirm it worked.
6. Freeze: record the release commit, the open known issues, and the maintenance checklist (dependency updates, security advisories, platform version changes, who to ask).
7. List the commands the user runs to publish and deploy, each marked "requires your authorization".

## Outputs

Updated version and changelog (as a diff for review), release notes, migration notes, rollback plan, maintenance checklist, and the publish and deploy commands.

## Verification

- Version numbers agree across every manifest.
- The changelog entry covers every user-visible change in the commit range.
- The rollback command names a version that exists.

## Safety

- Never publish, deploy, tag, push or merge. Prepare; the user ships.

## Limitations

- Release notes describe what the commits and verification show; unverified claims stay out.
