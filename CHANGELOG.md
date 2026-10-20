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
- `secret-scrubber`: the generic secret pattern backtracked quadratically on very long lines (80,000 characters took 12 seconds, now 21 ms).

### Known limitations
See the Known limitations page. Codex, Copilot and Gemini runtime is NOT TESTED.

## 0.1.0
The four Claude Code mods (each 0.1.0) and the `guardrail-mods` marketplace.
