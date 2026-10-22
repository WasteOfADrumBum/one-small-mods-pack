# Migrating from 0.1

- The four mods (`wcag-enforcer`, `design-guardrail`, `qa-gate`, `secret-scrubber`) and the `guardrail-mods` marketplace are unchanged. Existing installs keep working.
- New: the `privacy-guard` mod, the `modspack-agents` plugin, and the `modspack` command line tool.
- `secret-scrubber` now bounds its secret-name pattern; very long single-line files no longer stall it.
- Nothing is removed. You can adopt the CLI without touching the mods.
