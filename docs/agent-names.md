# Agent names

Each agent has a friendly display name and a stable technical ID.

| Display name | Role | Technical ID |
|---|---|---|
| Atlas | Release Manager | `release-manager` |
| Sentinel | Code Reviewer | `code-reviewer` |
| Scout | QA Engineer | `qa-engineer` |
| Echo | Accessibility Auditor | `accessibility-auditor` |
| Aegis | Security & Privacy Auditor | `security-privacy-auditor` |
| Forge | Release Engineer | `release-engineer` |

## Agent, skill, guard

- **Agent**: a specialised AI role that performs or evaluates work.
- **Skill**: reusable instructions for performing one workflow.
- **Mod or guard**: an automated mechanism that evaluates or enforces rules.

## The ID never changes

The technical ID is the agent's name in its definition and its file name on every platform (`.codex/agents/release-manager.toml`, `.github/agents/release-manager.agent.md`, `.gemini/agents/release-manager.md`, `agents/release-manager.md` in the Claude Code plugin). Installations, automation and configuration refer to it. A display name is a label kept beside it: it changes no instruction, tool, permission, skill or file.

## Rename an agent for your project

Add `agentNames` to `modspack.config.json`:

```json
{
  "agentNames": { "release-manager": "Mercury", "code-reviewer": "Hawkeye" }
}
```

Names must start with a letter, use letters, digits, spaces and hyphens, be at most 32 characters, be unique (ignoring case), and not equal another agent's ID. An unknown ID or an invalid name stops the command with exit code 2. Run `modspack init --yes` again to update the instruction block; `modspack agents` shows the result.

## Where names appear

The CLI (`modspack agents`), the ModsPack block that `init` writes into `AGENTS.md`, `CLAUDE.md` and `GEMINI.md`, these docs and the website. That block is how you can say "ask Atlas" and have the tool pick `release-manager`.

## Platform limitation

Claude Code, Codex, Copilot and Gemini CLI identify an agent by its name or file name. None has a verified separate display-name field, so ModsPack does not write display names into the native agent files; renaming the `name` there would break references. Invoke agents by ID in settings and commands (`copilot --agent release-manager`); use the display name in conversation.
