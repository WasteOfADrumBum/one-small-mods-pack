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

**Windows.** `npm run types`, `npm run build` and the test scripts run in PowerShell. `npm run validate` and `npm test` loop over the mods with POSIX shell syntax, so on Windows run them from Git Bash or WSL, or run `claude plugin validate` and `claude plugin test` per mod folder. All of these need the `claude` command on your PATH and signed in; without it the mod typecheck and live hook checks stay BLOCKED.

**Live Claude Code hooks.** Start `claude --plugin-dir mods/privacy-guard --plugin-dir mods/secret-scrubber --plugin-dir mods/design-guardrail --plugin-dir mods/modspack-agents` in a scratch project. Ask Claude to write a file containing a clearly fake key shaped like `AKIA` plus 16 capital letters and digits, and a made-up diagnosis beside a name. Expected: the write is refused or the value is redacted, with the reason. Run `/agents` and confirm the six agents are listed.

**Codex, Copilot, Gemini hooks and agents.** In a scratch project: `npm i -D one-small-modspack`, `npx modspack init --yes`, approve project hooks where asked (Codex: `/hooks`), start the tool, and ask it to write a file containing the same fake key. Expected: a denial naming the rule. Then ask it to use each agent by ID (`copilot --agent release-manager`, `@release-manager` in Gemini). Record the tool version and result.

**Accessibility by a person.** Not testable by automation: screen reader output (NVDA with Firefox or Chrome, VoiceOver with Safari, TalkBack on Android), real zoom and text-spacing settings, high-contrast and forced-colors modes, and voice control. Use the site (`npm run site`, then open `site/dist/index.html`) and `skills/wcag-audit/references/manual-checklist.md`.

## What `modspack release-check` means

It is a gate for the project it is run in: it reports whether that project's required checks passed. It does not certify that ModsPack itself, or any release of it, has completed verification. The items above are separate.
