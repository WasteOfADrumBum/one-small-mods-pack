# Known limitations

- **Not a compliance tool.** ModsPack does not certify HIPAA, WCAG, GDPR or any other compliance. The HIPAA-related review lists potential concerns in code. Organisational safeguards (policies, training, agreements, risk analysis) are NOT ASSESSED.
- **Automated accessibility checks find only part of WCAG 2.2 AA.** Keyboard, focus order, screen reader output and reading in context are NOT TESTED and are listed for a person to check.
- **Runtime on Codex, Copilot and Gemini CLI is NOT TESTED.** The adapters are built from the vendors' documentation and verified with fixtures and recorded payloads only.
- **Hooks fail open** and do not judge shell commands.
- **Secret and personal-data detection is pattern based.** It can miss values and flag harmless ones. History scans cover the newest commits (200 by default).
- **Claude Code mods** need the Claude Code harness to type-check and test; that is not part of the plain CLI.
