# ModsPack 2.0.0: manual acceptance record

Only a person fills in this file. An AI agent must not change a Result from PENDING, and must not
write the sign-off line. The release and website workflows refuse to publish or deploy while any
row is PENDING or FAIL, or while the sign-off line below is missing.

Allowed results: `PASS`, `FAIL`, `PENDING`, or `DEFERRED-BY-OWNER` (the owner accepts shipping
without this check; say why in Evidence). Automated equivalents already pass in CI (`site` job and
`npm run site:check`); they are listed in the last column so you know what is already covered.

## How to open the site

From a clone at the candidate commit: `npm ci && npm run site`, then serve it, for example
`npx --yes http-server site/dist -p 8080`, and open <http://localhost:8080/>. Or download the
`site-dist` artifact from the candidate's CI run. Paths below are relative to that address.

## Website accessibility (blocks website deployment and any accessibility claim)

| ID | Page | Interaction | Expected result | Tool / browser | Result | Evidence (file, screenshot or note) | Automated cover |
|---|---|---|---|---|---|---|---|
| A1 | `index.html` | Screen reader: read the page by headings (H key) and landmarks (D key) | One H1 "One Small ModsPack"; banner, navigation, main and contentinfo landmarks announced; skip link announced first | NVDA + Firefox or Chrome (Windows) | PENDING | | accessibility tree names |
| A2 | `skills.html` | Screen reader: type in the filter field | The field has a spoken label; the result count change is announced | NVDA + Firefox or Chrome | PENDING | | search check |
| A3 | `compatibility.html` | Screen reader: table navigation (Ctrl+Alt+arrows) | Column and row headers are read with each cell | NVDA, or Narrator + Edge | PENDING | | axe table rules |
| A4 | `agents.html`, `guards.html` | Screen reader: decorative icons and emoji | Decorative symbols are not read, or read once without noise | NVDA or Narrator | PENDING | | axe |
| A5 | every page (spot-check 4) | VoiceOver + Safari (macOS/iOS), if available | Same as A1 | VoiceOver | PENDING | | none |
| Z1 | `index.html`, `compatibility.html`, `docs-release-verification.html` | Browser zoom to 200% (Ctrl/Cmd +) | No text cut off or overlapping; no horizontal scroll except inside wide tables | Chrome or Edge, real zoom | PENDING | | reflow at 640 px width |
| Z2 | same pages | Browser zoom to 400% | Content reflows to one column; only wide tables scroll sideways, inside their own box | Chrome or Edge, real zoom | PENDING | | reflow at 320 px width |
| T1 | `getting-started.html` | Text spacing bookmarklet (line height 1.5, paragraph 2x, letter 0.12em, word 0.16em) | No clipped or overlapping text | Any browser | PENDING | | text-spacing check |
| H1 | `index.html`, `skills.html` | Windows High Contrast (Settings > Accessibility > Contrast themes: Night sky / Desert) | Links, buttons, focus outline and the filter field stay visible with boundaries | Edge or Chrome on Windows 11 | PENDING | | forced-colors emulation |
| K1 | `index.html` | Keyboard only: Tab from page load | First stop is "Skip to main content"; Enter moves focus to main; every stop shows a visible outline | Any browser | PENDING | | keyboard order and outline |
| K2 | `compatibility.html` | Keyboard only: reach and scroll the wide table | The table container can be focused and scrolled with arrow keys | Any browser | PENDING | | none |
| K3 | `skills.html` | Keyboard only: filter, then Tab into results | Filtering works without a mouse; focus is never lost or trapped | Any browser | PENDING | | search check |

## Platform checks

These need your own signed-in tools. If you choose to ship without them, mark the row
`DEFERRED-BY-OWNER`: the integration then stays documented as unverified, exactly as it is now.

| ID | Platform | Interaction | Expected result | Tool | Result | Evidence | Automated cover |
|---|---|---|---|---|---|---|---|
| P1 | OpenAI Codex | In a disposable project with ModsPack installed from the tarball, open Codex, trust the project hook in `/hooks`, ask it to write a file holding `AKIA` + 16 random capitals/digits | The write is denied, naming `aws-access-key-id`; after restarting Codex the trust persists | Codex CLI (record version) | PENDING | | live deny with trust bypassed (0.159.3) |
| P2 | GitHub Copilot CLI | Signed in, same project: ask it to create the same file; then `copilot --agent release-manager` | Write denied by the preToolUse hook; the agent loads | Copilot CLI (record version) | PENDING | | recorded payloads; skill list 1.0.105 |
| P3 | Gemini CLI | Signed in, trusted project: same write; then `@release-manager` | Write denied by the BeforeTool hook; the agent loads | Gemini CLI (record version) | PENDING | | recorded payloads; skill list 0.66.0 |

## Sign-off

Replace the placeholder line with your own, for example
`Owner sign-off: Joshua Small on 2026-11-02`. The workflows look for a line that starts with
`Owner sign-off:` followed by a name and an ISO date.

Owner sign-off: <not signed>
