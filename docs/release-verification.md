# 2.0 pre-release verification

Checkpoint: 2026-10-21, America/New_York. Base: PR #3 at
`1c372fac7138d5fec2db1ce5691cf14d6bb1b5b6`. **NO-GO for release.**
No merge, tag, npm publication or deployment was performed.

## Evidence and status

| Area | Status | Evidence and limit |
| --- | --- | --- |
| Baseline CLI checks | PASS | `npm run check`: 84 CLI tests, shared files, CLI typecheck, plugin validation and 131 mod tests passed on Windows. |
| Final checks after fixes | PASS | `npm run check`: 85 CLI tests (including the new installed-artifact regression), 131 mod tests, shared files, CLI typecheck and plugin validation. Windows, Node 26.12.0, npm 11.20.0, Claude Code 2.1.307. This does not establish Node 20 coverage. |
| Five guard mods, primary live behavior | PASS (prior user-reported evidence) | The handoff reports all five passing. Recovered QA Gate transcript shows automatic PASS → FAIL → PASS, Stop enforcement, no extra run on the no-change turn, and cleanup. Recovered WCAG transcript shows contrast, axe and Stop enforcement. This run did not repeat every live guard test. |
| WCAG ESLint live path | PASS | Claude Code 2.1.307, ESLint 9.39.5 and jsx-a11y 6.10.2 in an isolated JSX fixture. A real Edit removed `alt`; automatic hook context reported `Fixture.jsx:1:44 [jsx-a11y/alt-text]`. A real Edit restored it and emitted no finding; the turn completed. An independent final ESLint run returned exit 0. No manual ESLint command substituted for the failing edit's automatic hook. |
| WCAG ESLint Stop enforcement | NOT RETESTED | The new test fixed the violation within the turn. Separate-turn Stop evidence is from the earlier contrast test, not this JSX test. |
| Codex instruction and skill discovery | PASS | Installed Codex 0.159.3: `debug prompt-input` succeeded, and a real read-only `exec` session identified the ModsPack block and all 12 skill names. No skill execution, custom agent invocation or hook denial is inferred from discovery. |
| Codex hook enforcement | NOT TESTED | Project hooks require explicit runtime trust through `/hooks`; no trust bypass or global setting change was used. |
| Copilot / Gemini runtime | NOT TESTED here | Neither CLI was on PATH. Earlier discovery-only results remain historical evidence. No runtime or model-use claim is added. |
| Site structure, names, links, source consistency | PASS | Existing CLI suite includes generated-site jsdom/axe and link/definition checks. This is not a manual accessibility review. |
| Site real-browser automation | BLOCKED | Both installed Edge and isolated Playwright Chromium closed at launch; harness returned NOT TESTED (exit 3). |
| Keyboard, screen reader, real zoom, forced colors | NOT TESTED | Native Computer Use stopped because it could not confidently determine the browser URL for policy enforcement. No completed manual website review is claimed. Viewport resizing is not real browser zoom, and accessibility-tree inspection is not screen-reader output. |
| Plugin icons | WARNING | All six plugins pass validation but emit ICON_MISSING. This is a directory/listing warning, not a guard-test failure. No placeholder artwork or directory submission was introduced. |
| npm artifact | FIXED / PASS | Before fix, packed `modspack validate` exited 3 with ENOENT for `.claude-plugin/marketplace.json`. The file is now included; a regression test packs and installs the tarball, validates it, initializes all four platforms and runs doctor. |
| Public npm registry | CHECKED | Registry returned E404 for `one-small-modspack`; no existing public package was found. This does not prove ownership or reserve the name. |
| Dependency audit | INCONCLUSIVE | `npm audit --json --fetch-retries=0 --fetch-timeout=10000` timed out at the registry advisories endpoint. Do not interpret the missing result as zero vulnerabilities. |

The ESLint 9 fixture is isolated test tooling; npm reports that major as unsupported.
It was used to exercise the supported flat-config integration, not added as a
ModsPack dependency or recommended for new projects.

## Source of truth and distribution

- Agent bodies and skills: `mods/modspack-agents/agents` and `skills`; display metadata: `identities.json`.
- Guard documentation and platform evidence: `catalog/guards.json` and `catalog/compatibility.json`.
- Marketplace membership: `.claude-plugin/marketplace.json`. npm package identity/version/files: `package.json`; dependency resolution: `package-lock.json`.
- CLI renderers consume canonical definitions; `site/build.mjs` generates pages from definitions, catalogs and docs. Generated output is not a second editable registry.
- Native adapter hooks require a locally installed package. Getting started now explains this and the unpublished tarball test path.
- `modspack release-check` evaluates a consuming project. It does not certify this toolkit's own release.
- Plugin validation also warns that module hooks need the developer portal's own validation before directory submission. Passing local validation does not certify portal acceptance.

## Go/no-go checklist

- [x] Reproduce and fix the installed-artifact validation crash; retain an artifact regression test in CI's CLI suite.
- [x] Close the missing WCAG jsx-a11y automatic Edit path with actual runtime evidence.
- [x] Preserve clear limits on Codex/Copilot/Gemini support; discovery alone does not prove enforcement.
- [ ] Complete browser keyboard navigation, skip link, table scrolling, search and focus visibility checks on the final generated site.
- [ ] Complete screen-reader headings/landmarks, search announcements and decorative-icon review with NVDA and a supported browser.
- [ ] Complete actual 200%/400% browser zoom, text spacing and Windows forced-colors review; record browser/AT versions and results.
- [ ] Obtain a successful dependency audit response and triage findings.
- [ ] Verify Codex hooks after project trust, and Copilot/Gemini in installed authenticated runtimes; otherwise explicitly accept those integrations as experimental with unverified enforcement before release.
- [ ] Resolve icon artwork before any plugin-directory submission, or explicitly defer directory listing. No icon is required to prove local guard behavior.
- [ ] Review final PR CI, package contents and npm ownership/access immediately before an authorized release.
- [ ] Obtain explicit authorization for merge, tagging, publishing and deployment.

The release remains a draft until the blocking checks above are completed or an
explicit, documented scope decision defers the unverified integrations. Manual
accessibility and vulnerability-audit gaps remain open; no blanket PASS is implied.
