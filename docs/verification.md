# Verification

What has been checked, how, and what still needs a person or a tool that was not available. Statuses: PASS, PARTIAL, NOT TESTED, BLOCKED.

## Checked by automated tests (every CI run)

- CLI, security, privacy, install and uninstall, hooks (recorded payloads for each platform), agent identities and the website: `npm run test:cli`.
- The Claude Code mods: `npm test` (runs `claude plugin test` for each mod) and `npm run validate`.
- Shared-file copies, definitions, schema and catalogs: `npm run shared`, `modspack validate`.
- Website in jsdom with axe-core, link and anchor validation, definitions-versus-pages checks.

## Checked in real tools without a model or login

In a project set up by `modspack init` (2026-10-20):

| Tool | Command | Result |
|---|---|---|
| Codex 0.163.0 | `codex debug prompt-input "hi"` | PASS: the ModsPack block from `AGENTS.md` and all 12 skills are in the model-visible input |
| Gemini CLI 0.64.0 | `gemini skills list` (trusted workspace) | PASS: 12 skills Enabled from `.agents/skills` |
| Copilot CLI 1.0.100 | `copilot skill list` | PASS: 12 project skills listed |

These show discovery. Not covered: custom agent loading, a hook firing, a model following the instructions. Those need a login: NOT TESTED.

## Check the rest on your machine

**Mod typecheck.** Claude Code writes its type declarations itself; there is no download. Two ways to get them, then check:

1. Ask Claude Code to use its bundled `plugin-authoring` skill. The skill text names the `claude-code.d.ts` it just wrote for your Claude Code version. Run `node scripts/link-types.mjs <that path>` (quote the path in PowerShell).
2. Or start `claude --plugin-dir mods/qa-gate` where mods are enabled; once the mod loads, the declarations are in `mods/qa-gate/.claude-plugin/types/claude-code/index.d.ts`, and `npm run types` finds them without an argument.

Then `npm run typecheck`. Fix real errors; never add stub declarations or suppress errors. On 2026-10-20 this passed with 0 errors against the file Claude Code 2.1.304 wrote through route 1 (Linux).

The declarations come in two shapes, and the mods typecheck against both. With a tool table, `e.tool === 'Write'` narrows `e.file_path` to `string`. Without one (the file Claude Code 2.1.304 wrote on Windows), a tool call's arguments are `unknown`. That is also the truth at run time, since the model sends JSON. So every hook narrows what it reads with `asString` before use:

| Field missing or not a string | Behaviour |
| --- | --- |
| `file_path` / `notebook_path` (design-guardrail, privacy-guard, wcag-enforcer, qa-gate) | The call passes through unscanned; the tool itself rejects it, and no file was written to check. qa-gate counts no code change. |
| `content`, `old_string`, `new_string` | Treated as empty text. The path is still checked. |
| `command` (Bash hooks) | No shell write is looked for; the call passes through. |
| `file_path` / `command` (secret-scrubber) | Not treated as a `.env` read; tool output is still scrubbed by its patterns. |

Each mod has a `malformed tool arguments` test group that sends such calls as JSON text (so they are as untyped as on the wire) and also shows the same call with real strings is still refused or checked. On 2026-10-20 the 25 errors seen on Windows were reproduced on Linux by removing the tool table from the declarations; after the fix `npm run typecheck` reports 0 errors against both shapes, and the mod tests pass (118: design-guardrail 32, privacy-guard 19, qa-gate 24, secret-scrubber 20, wcag-enforcer 23).

**Line endings.** Git holds the definitions as LF (`.gitattributes`: `* text=auto eol=lf`). A working tree cloned before that file existed, or with `core.autocrlf=true`, can still hold CRLF until files are checked out again. The CLI reads every definition through `readLf`, so loading, rendering, hashing and installing give the same bytes either way, and uninstall restores from the same content. The tests compare through `readLf` and check the git index for LF rather than assuming the working tree is LF. To refresh an old CRLF checkout without rewriting history: `git rm --cached -r -q . && git reset --hard` (this discards uncommitted changes, so commit or stash first). Verified on Linux by rewriting a whole clone to CRLF: the earlier two tests failed exactly as seen on Windows, and the full suite (75) passes with the corrected tests. That is a simulation; native Windows is proven only by the `windows` CI job and your own runs.

**Windows.** `npm run types`, `npm run build`, `npm run validate`, `npm test` and the test scripts run the same in PowerShell, macOS and Linux. `validate` and `test` use `scripts/run-mods.mjs`, a small Node runner that runs `claude plugin validate` on the root plugin and then every `mods/<name>`, and `claude plugin test` in each mod that has tests, passing each path as one argument (spaces are fine) and stopping at the first failure with that command's exit status. It exits 3 (BLOCKED) when `claude` is not on PATH. The earlier POSIX `for` loops failed in Windows' npm shell with `mod was unexpected at this time.` All of these need the `claude` command on your PATH and signed in; without it the mod typecheck and live hook checks stay BLOCKED.

To verify on Windows, from the repository root in PowerShell: `npm ci`, `npm run build`, `npm run validate`, `npm test`, `npm run check`. A failing plugin shows `FAIL: claude plugin validate <dir> exited <n>` and the command exits non-zero.

**Mod tests on Windows.** The Windows engine reports file paths with backslashes. The mods' test stubs find fixture files by path ending, so they compare with `/` and `\` treated alike. The hooks themselves pass paths through to the engine unchanged and normalise only to judge them (`normalizePath`). design-guardrail's `paths as a Windows engine reports them` group sends backslash paths to the stubs and checks that a tokens file in a folder is still found, a shell command's changes are still checked, and a missing tokens file still toasts rather than passing silently. Run the mods one at a time to see each count: `claude plugin test mods/<name>` (design-guardrail 35, privacy-guard 19, qa-gate 24, secret-scrubber 20, wcag-enforcer 23).

**Live Claude Code hooks.** Start `claude --plugin-dir mods/privacy-guard --plugin-dir mods/secret-scrubber --plugin-dir mods/design-guardrail --plugin-dir mods/modspack-agents` in a scratch project. Ask Claude to write a file containing a clearly fake key shaped like `AKIA` plus 16 capital letters and digits, and a made-up diagnosis beside a name. Expected: the write is refused or the value is redacted, with the reason. Run `/agents` and confirm the six agents are listed.

**Codex, Copilot, Gemini hooks and agents.** In a scratch project: `npm i -D one-small-modspack`, `npx modspack init --yes`, approve project hooks where asked (Codex: `/hooks`), start the tool, and ask it to write a file containing the same fake key. Expected: a denial naming the rule. Then ask it to use each agent by ID (`copilot --agent release-manager`, `@release-manager` in Gemini). Record the tool version and result.

**Accessibility by a person.** Not testable by automation: screen reader output (NVDA with Firefox or Chrome, VoiceOver with Safari, TalkBack on Android), real zoom and text-spacing settings, high-contrast and forced-colors modes, and voice control. Use the site (`npm run site`, then open `site/dist/index.html`) and `skills/wcag-audit/references/manual-checklist.md`.

## What `modspack release-check` means

It is a gate for the project it is run in: it reports whether that project's required checks passed. It does not certify that ModsPack itself, or any release of it, has completed verification. The items above are separate.
