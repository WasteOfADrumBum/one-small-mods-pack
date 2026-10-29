---
name: claude-mod-compatibility
description: Checks Claude Code mods (TypeScript hooks modules) against the installed Claude Code build - manifest validation, declared events and calls, type check against the build's declarations, and the test harness. Use after a Claude Code update, before releasing a mod, or when a mod stops loading.
license: MIT
compatibility: Requires Claude Code 2.1.287 or later on PATH.
metadata:
  modspack-category: quality
  modspack-agent: qa-engineer
---

# Claude mod compatibility

Confirm each mod still validates, type-checks and passes its tests on the Claude Code build in use.

## When to use

- After updating Claude Code.
- Before releasing a change to a mod.
- When a mod stops loading or a hook stops firing.

## Prerequisites

- `claude --version` works. The repository's mods live under `mods/<mod>/` with `hooks/hooks.json`.

## Inputs

- The mods to check (default: all under `mods/`).

## Steps

1. Record `claude --version`.
2. Validate: `claude plugin validate <mod>` for each mod and the marketplace root. Read the listed hooks and calls; a hook the build no longer declares fails validation.
3. Type check: start `claude --plugin-dir mods/<mod>` once so Claude Code writes its declarations beside the mod, run `npm run types`, then `npm run typecheck`. If the build does not load mods in this environment, the type check is BLOCKED; say so.
4. Test: `claude plugin test <mod>` for each mod with tests.
5. For each failure, compare the event or API with the build's declarations and update the mod, keeping its configuration keys unchanged.

## Outputs

A table per mod: validate, typecheck, test, each PASS, FAIL or BLOCKED with the command and Claude Code version.

## Verification

- All three columns are filled from commands run in this session.

## Safety

- The type declarations are Anthropic's and are not redistributed; keep `types/` git-ignored.

## Limitations

- The test harness stubs the engine; it does not prove behaviour in a live session.
