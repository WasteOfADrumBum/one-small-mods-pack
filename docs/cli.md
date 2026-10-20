# CLI reference

Run `modspack --help` for the same list. Every check command accepts `--json`, `--write`, `--advisory` and `--dir <path>`.

| Command | What it does |
|---|---|
| `inspect` | Reports the project, the AI configuration already present, duplicates and risky settings. Read-only. User-level folders are reported NOT INSPECTED unless you pass `--user`. |
| `init` | Previews the installation; `--yes` applies it. |
| `doctor` | Checks an installation is present and unmodified. |
| `uninstall` | Removes what `init` installed. `--yes` applies it. |
| `check` | Runs the project's lint, typecheck, spellcheck, test and build scripts. |
| `security` | Secrets in the tree and history, CI and install-script risks, client-exposed secrets, public source maps. |
| `privacy` | Personal and health data. Adds a HIPAA-related review when health data appears. |
| `accessibility` | Contrast, axe-core and jsx-a11y; lists the manual checks still needed. |
| `release-check` | Runs every required gate and prints READY or NOT READY. |
| `agents` | Lists the agent roles. |
| `skills` | Lists the skills. |
| `validate` | Validates the shipped definitions, schema and catalogs. |
| `hook <platform>` | Pre-write guard for `codex`, `copilot` or `gemini`; reads the tool call on stdin. |

## Status words

Every result is one of PASS, FAIL, PARTIAL, SKIPPED, BLOCKED or NOT TESTED. A tool that is missing is never a pass: a required check that cannot run is BLOCKED.

## Exit codes

- 0: ok
- 1: a gate failed, or the verdict is NOT READY
- 2: usage or configuration error
- 3: a required check could not run (also in advisory mode)
