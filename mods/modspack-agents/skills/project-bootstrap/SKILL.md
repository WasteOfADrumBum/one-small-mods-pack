---
name: project-bootstrap
description: Installs ModsPack into an existing project safely - inventory first, preview every file change, merge into existing instructions with marked blocks, never overwrite, verify afterwards, and uninstall cleanly. Use when adding ModsPack agents, skills, hooks or CI checks to a repository.
license: MIT
metadata:
  modspack-category: setup
  modspack-agent: release-engineer
---

# Project bootstrap

Add ModsPack to a project without breaking what it has.

## When to use

- Setting up ModsPack in a repository for the first time.
- Adding another AI tool's integration to a project that already has ModsPack.
- Updating or removing an existing installation.

## Prerequisites

- Node.js 20 or later. A git working tree with no uncommitted changes, so every change is reviewable as a diff.

## Inputs

- Which AI tools the team uses (default: the ones detected).
- Which skills and agents to install (default: all).

## Steps

1. Run the `agent-inventory` skill (`npx one-small-modspack inspect`). Resolve duplicates it reports before installing.
2. Preview: `npx one-small-modspack init`. With no flags it changes nothing and prints every file it would create or update.
3. Choose platforms explicitly when needed: `--platform claude-code,codex,copilot,gemini`. Add `--ci` for a GitHub Actions workflow running `modspack release-check`.
4. Apply: `npx one-small-modspack init --yes`. Existing instruction files get a marked block (`<!-- modspack:start -->` ... `<!-- modspack:end -->`) appended; nothing outside it is touched. A file that exists and is not ModsPack's is never overwritten; it is reported as a conflict.
5. For Claude Code, install the guard mods from the marketplace: `/plugin marketplace add WasteOfADrumBum/one-small-mods-pack`, then `/plugin install <mod>@guardrail-mods`.
6. Verify: `npx one-small-modspack doctor`. Then `git diff` and commit.
7. Update later by re-running `init --yes`: files ModsPack wrote and nobody edited are refreshed; edited ones are left alone and reported.
8. Remove with `npx one-small-modspack uninstall --yes`: deletes only unmodified files it wrote, removes its marked blocks, and keeps everything else.

## Outputs

The planned and applied changes, the doctor report, and the manifest at `.modspack/manifest.json` recording what was installed and each file's hash.

## Verification

- `modspack doctor` reports every installed file present and unmodified.
- Running `init --yes` twice leaves no diff the second time.
- `git diff` shows no change outside ModsPack's files and marked blocks.

## Safety

- Never overwrite a file ModsPack did not create.
- Installs only ModsPack's own definitions; never fetches third-party skills.
- Hooks for Codex, Copilot and Gemini run the local `modspack` CLI only; Codex asks the user to trust project hooks before they run.

## Limitations

- Native runtime behaviour differs per AI tool; see the compatibility matrix in the README.
