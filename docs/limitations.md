# Known limitations

- **Not a compliance tool.** ModsPack does not certify HIPAA, WCAG, GDPR or any other compliance. The HIPAA-related review lists potential concerns in code. Organisational safeguards (policies, training, agreements, risk analysis) are NOT ASSESSED.
- **Automated accessibility checks find only part of WCAG 2.2 AA.** Keyboard, focus order, screen reader output and reading in context are NOT TESTED and are listed for a person to check.
- **Codex hooks block nothing until you trust them in `/hooks`.** Codex skips an untrusted project hook silently, so a secret write goes through. With trust bypassed, a live Codex 0.159.3 run denied an AWS-format key. The documented AWS example key (`...EXAMPLE`) is allowed on purpose as a placeholder.
- **Gemini CLI ignores project skills, agents and hooks in an untrusted folder.** Gemini CLI 0.66.0 reports "No skills discovered" and disables project hooks until the folder is trusted.
- **Hook enforcement on Copilot and Gemini CLI, and custom agents and skill execution on all three, are NOT TESTED.** Instruction/skill discovery has limited real-runtime evidence; adapters also have fixture and recorded-payload tests. See [verification](verification.md) for the exact coverage.
- **Hooks fail open** and do not judge shell commands. The exception is `secret-scrubber`, which fails closed: if its scan throws, the tool output is withheld.
- **`secret-scrubber` protects what the model reads, not your local logs.** Claude Code's own transcript (and the `tool_use_result` field of `--output-format stream-json`) still holds the raw tool output.
- **Secret and personal-data detection is pattern based.** It can miss values and flag harmless ones. History scans cover the newest commits (200 by default).
- **Claude Code mods** need the Claude Code harness to type-check and test; that is not part of the plain CLI.
- **Agent display names are not written into native agent files.** No platform has a verified separate display-name field, so only the ID is used there. See [agent names](agent-names.md).
