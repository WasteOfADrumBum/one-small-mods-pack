# One Small ModsPack 2.0.0

One set of AI development agents, Agent Skills and guards for Claude Code, OpenAI Codex, GitHub
Copilot and Gemini CLI, plus the `modspack` command line tool that runs the same deterministic
checks in CI with no AI model and no network (the dependency audit is opt-in).

## Install

```text
npm install --save-dev one-small-modspack
npx modspack inspect          # read-only
npx modspack init             # preview; add --yes to apply
npx modspack doctor
npx modspack release-check    # READY or NOT READY
```

Claude Code guard mods: `/plugin marketplace add WasteOfADrumBum/one-small-mods-pack`, then
`/plugin install <mod>@guardrail-mods` for `wcag-enforcer`, `design-guardrail`, `qa-gate`,
`secret-scrubber`, `privacy-guard` and `modspack-agents`.

Requires Node.js 20 or later. Remove with `npx modspack uninstall --yes`.

## What's new

- `modspack` CLI: inspect, init, doctor, uninstall, check, security, privacy, accessibility,
  release-check, agents, skills, validate and hook.
- Six agent roles: Atlas (release manager), Sentinel (code reviewer), Scout (QA engineer),
  Echo (accessibility auditor), Aegis (security and privacy auditor), Forge (release engineer).
- Twelve Agent Skills shared by all four tools through `.agents/skills`.
- New `privacy-guard` mod; `design-guardrail`, `qa-gate`, `secret-scrubber` and `wcag-enforcer` 0.1.1.
- Reversible installer for all four tools: marker blocks in `AGENTS.md`, `CLAUDE.md` and `GEMINI.md`,
  never overwriting your files; uninstall restores them.

Full list: [CHANGELOG.md](https://github.com/WasteOfADrumBum/one-small-mods-pack/blob/main/CHANGELOG.md).

## What is verified, per platform

| | Claude Code | Codex | Copilot CLI | Gemini CLI |
|---|---|---|---|---|
| Instructions found | static | live (0.166.0, 0.159.3) | live (1.0.105) | static |
| Skills found | static | live (0.166.0) | live (1.0.105) | live (0.66.0, trusted folder) |
| Guards enforce | live, all five (2.1.316) | live only with hook trust (0.159.3) | recorded payloads only | recorded payloads only |
| Custom agents / model use | not tested | not tested | not tested | not tested |

Details: `catalog/compatibility.json` and the Integrations page.

## Known limitations

- Not a compliance tool: no WCAG, HIPAA, GDPR or security certification. Automated accessibility
  checks cover part of WCAG 2.2 AA.
- Codex project hooks do nothing until trusted in `/hooks`; Gemini CLI ignores project skills,
  agents and hooks in an untrusted folder.
- Hooks fail open (except `secret-scrubber`, which withholds output it could not scan) and do not
  judge shell commands.
- Secret and personal-data detection is pattern based.
- See the Known limitations page for the full list.

## Upgrading from 0.1

The four 0.1 mods keep their names and the `guardrail-mods` marketplace. Run `/plugin update` in
Claude Code. See the migration page.

## Integrity

npm package published with provenance from `.github/workflows/release.yml`.
Tarball SHA-256: `<filled in from the release run's SHA256SUMS>`. Commit: `<candidate sha>`.

## Rollback

`npm deprecate` the version and publish a fixed patch; `npx modspack uninstall --yes` in a project.
