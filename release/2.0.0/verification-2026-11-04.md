# ModsPack 2.0.0: final-candidate verification pass (2026-11-04)

Agent-reported (Claude Code, cloud Linux container). Nothing here is a human verification or an
approval. Nothing was published, tagged or deployed. Release approval belongs to Joshua Small.

## What was checked and why

`main` moved from `b0ff54a` (the proposed candidate) to `26b5ccd` through PR #6 (`release.yml`
only) and PR #7 (Engineering Hub checkpoint only). Neither touches a shipped file, so the earlier
evidence on `b0ff54a` still describes the package. This pass reran only what was stale, missing or
needed to tie the evidence to the current head.

Base: `main` at `26b5ccdef6602a11b0970cee66b2b865c9f59b17`. Node 22.23.4, npm 10.9.9,
Claude Code 2.1.318.

| Check | Why it was run | Result |
| --- | --- | --- |
| Package identity | Confirm the head still ships what `b0ff54a` shipped | PASS: `npm pack` gives 82 files, equal to `release/package-files.txt`; sha256 `8fb17e484e8ae7ea8ab1f289dc517685463349ff85b193d7ece6312055a8fab7`, byte-identical to the `b0ff54a` tarball. |
| Mod typecheck (`npm run typecheck`) | Last run 2026-10-20, before later hook and test changes; never run against current declarations | PASS, 0 errors, against the `claude-code.d.ts` written by Claude Code 2.1.318 (its bundled plugin-authoring skill). Covers the `hooks/` and `tests/` of all five guard mods, including privacy-guard (4 hook files, 1 test file). modspack-agents has no TypeScript (agents and skills are Markdown), so typecheck does not apply to it; `claude plugin validate` covers it. |
| modspack-agents live in Claude Code | No earlier live run loaded this plugin (every 2026-10-31 run listed only built-in agents) | PASS: `claude -p --plugin-dir mods/modspack-agents` listed all six agents (`modspack-agents:release-manager`, `code-reviewer`, `qa-engineer`, `accessibility-auditor`, `security-privacy-auditor`, `release-engineer`) and all twelve skills; a second run delegated to `modspack-agents:release-manager` through the Agent tool and returned its role and first rule. |
| privacy-guard live in Claude Code | Confirm coverage | Already covered: 2026-10-31 run (Claude Code 2.1.316) refused a Write holding an SSN. Not rerun. |
| `npm run check` | Confirm on the head | PASS: 91 CLI tests, shared files, CLI typecheck, `claude plugin validate` on all six plugins (only ICON_MISSING warnings), 133 mod tests (35 + 29 + 24 + 22 + 23). |
| `npm run site:check` | Confirm on the head | PASS: 18 pages (axe light/dark, 200%/400% reflow widths, text spacing, emulated forced colors, keyboard, search, accessibility tree, reduced motion, no-JS). Automation only. |
| `npm audit --omit=dev --audit-level=low`, `npm audit --audit-level=high` | Advisories change over time | PASS: 0 vulnerabilities each. |
| Packed artifact smoke (`scripts/consumer-smoke.mjs --tarball`) | Confirm on the head | PASS 40/40 (Node 22.23.4). Node 20 and 24 and macOS run in CI on every push. |
| npm registry | Name availability changes | `npm view one-small-modspack`: E404 (not published; a 404 is not a reservation). |
| Release dry run (run 41235745436) | Reconcile the record | Used `candidate_sha` `b0ff54a…`, with the workflow file from `2681b06` (PR #6). PASS on every gate. |

## Codex, Copilot and Gemini in this container

| Tool | What was possible | Status |
| --- | --- | --- |
| Codex 0.166.0 | No OpenAI credentials in this container; hooks only fire on model tool calls | Discovery verified 2026-10-31 (same version, not rerun). Interactive `/hooks` trust and live enforcement: UNVERIFIED. |
| Copilot CLI 1.0.105 | `copilot -p` with the session's GitHub token: refused ("To authenticate…"); the token is scoped to this session's git proxy and has no Copilot access | Skill and instruction discovery verified 2026-10-31. Hooks, custom agents and model use: UNVERIFIED. |
| Gemini CLI 0.66.0 | No Gemini or Google credentials in this container | Skill discovery in a trusted folder verified 2026-10-31. Hooks, agents and model use: UNVERIFIED. |

Recorded payload and fixture tests are not live enforcement and are not counted as such.

## npm provenance and trusted publishing

- `release.yml` publish job: `id-token: write`, Node 24, npm upgraded to `^11.5.1`, publishes the
  exact verified tarball with `--provenance --access public`. The repository is public and
  `package.json` `repository.url` is `git+https://github.com/WasteOfADrumBum/one-small-mods-pack.git`.
  These meet npm's documented provenance requirements.
- npm can trust a publisher only for a package that already exists, so 2.0.0 (the first
  publication) must authenticate with a short-lived token in the `npm-publish` environment. It still
  gets a provenance attestation, because `--provenance` signs with the workflow's GitHub OIDC
  identity. From the next version on, trusted publishing replaces the token.
- This was not and cannot be exercised end to end without publishing. No provenance exists until
  the package is published.
- Account access could not be checked here: `npm whoami` fails with ENEEDAUTH (no npm login in the
  container). The owner checks it (`release/README.md`, one-time setup).

## Evidence files

Kept in the project's shared folder (`modspack-2-0/evidence-2026-11-04/`): the two Claude Code
stream-json transcripts, and the `npm run check` and `site:check` logs.
