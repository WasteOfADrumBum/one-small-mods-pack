# Changelog

## 2.0.0 (unreleased)

### Added
- `modspack` command line tool: inspect, init, doctor, uninstall, check, security, privacy, accessibility, release-check, agents, skills, validate, hook.
- Six agent roles and twelve shared Agent Skills.
- `privacy-guard` mod: personal and health data detection and a HIPAA-related review that never claims compliance.
- Adapters for Claude Code, OpenAI Codex, GitHub Copilot and Gemini CLI with a reversible installer.
- Friendly agent names (Atlas, Sentinel, Scout, Echo, Aegis, Forge) as metadata, customisable with `agentNames`; technical IDs and native agent files unchanged.
- Public documentation website generated from the definitions and catalogs.
- CI workflow for this repository.

### Fixed
- Mod typecheck against the real Claude Code declarations: tool arguments are `unknown`, so design-guardrail, privacy-guard, qa-gate, secret-scrubber and wcag-enforcer narrow them with `asString` before use (25 errors to 0). A missing or non-string field never throws; behaviour for each is in `docs/verification.md`, with `malformed tool arguments` tests in every mod.
- Windows: two CLI tests assumed the working tree is LF. They now compare through `readLf` and check the git index, with a new test that rendering from a CRLF checkout is byte-identical. No product code changed for this.
- Windows: `npm run types`, `build` and the other repository scripts derived the repository path from `new URL(import.meta.url).pathname`, which produced `C:\C:\Users\...` and ENOENT. They now use `fileURLToPath` left to the platform's own rules (`scripts/root.mjs`; an earlier attempt passed `windows: false` explicitly, which still doubled the drive on native Windows), with regression tests that evaluate both rule sets on any OS and a native Windows CI job. The published CLI was not affected.
- `secret-scrubber`: the generic secret pattern backtracked quadratically on very long lines (80,000 characters took 12 seconds, now 21 ms).

- Windows (found by a native Windows CI job): `npm`, `pnpm`, `yarn` and `eslint` are command shims there, so the quality and package gates reported "could not run npm: spawn ENOENT"; they now run npm through node and other shims only with shell-safe arguments. Skill file links were reported missing because of backslash separators, and CRLF checkouts broke front matter and the site's tables; paths are normalised and line endings are read as LF, and `.gitattributes` keeps checkouts LF.

### Known limitations
See the Known limitations page. Codex, Copilot and Gemini runtime is NOT TESTED.

## 0.1.0
The four Claude Code mods (each 0.1.0) and the `guardrail-mods` marketplace.
