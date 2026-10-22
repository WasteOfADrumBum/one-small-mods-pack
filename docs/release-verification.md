# 2.0 pre-release verification

Checkpoint: 2026-10-21, America/New_York. Base: PR #3 at
`1c372fac7138d5fec2db1ce5691cf14d6bb1b5b6`; second pass on `559d010`. **NO-GO for release** until the manual items below are done.
No merge, tag, npm publication or deployment was performed.

## Evidence and status

| Area | Status | Evidence and limit |
| --- | --- | --- |
| Baseline CLI checks | PASS | `npm run check`: 84 CLI tests, shared files, CLI typecheck, plugin validation and 131 mod tests passed on Windows. |
| Final checks after fixes | PASS | `npm run check` after the second-pass fixes: 86 CLI tests, 131 mod tests, shared files, CLI typecheck and `claude plugin validate`/`test` on every plugin. Windows, Node 26.12.0, npm 11.20.0, Claude Code 2.1.307. |
| Five guard mods, primary live behavior | PASS (prior user-reported evidence) | The handoff reports all five passing. Recovered QA Gate transcript shows automatic PASS → FAIL → PASS, Stop enforcement, no extra run on the no-change turn, and cleanup. Recovered WCAG transcript shows contrast, axe and Stop enforcement. This run did not repeat every live guard test. |
| WCAG ESLint live path | PASS | Claude Code 2.1.307, ESLint 9.39.5 and jsx-a11y 6.10.2 in an isolated JSX fixture. A real Edit removed `alt`; automatic hook context reported `Fixture.jsx:1:44 [jsx-a11y/alt-text]`. A real Edit restored it and emitted no finding; the turn completed. An independent final ESLint run returned exit 0. No manual ESLint command substituted for the failing edit's automatic hook. |
| WCAG ESLint Stop enforcement | NOT RETESTED | The new test fixed the violation within the turn. Separate-turn Stop evidence is from the earlier contrast test, not this JSX test. |
| Codex instruction and skill discovery | PASS | Installed Codex 0.159.3: `debug prompt-input` succeeded, and a real read-only `exec` session identified the ModsPack block and all 12 skill names. No skill execution, custom agent invocation or hook denial is inferred from discovery. |
| Codex hook enforcement | NOT TESTED | Project hooks require explicit runtime trust through `/hooks`; no trust bypass or global setting change was used. |
| Copilot / Gemini runtime | NOT TESTED here | Neither CLI was on PATH. Earlier discovery-only results remain historical evidence. No runtime or model-use claim is added. |
| Site structure, names, links, source consistency | PASS | Existing CLI suite includes generated-site jsdom/axe and link/definition checks. This is not a manual accessibility review. |
| Site real-browser automation | PASS | `scripts/site-browser-check.mjs` on 18 pages in Edge 155.0.4283.62 and Playwright Chromium 153.0.8010.12: axe (WCAG 2.2 A/AA + best-practice) in light and dark, 320 px reflow, 200%/400% reflow (viewport width equivalents, not browser zoom), text spacing (WCAG 1.4.12), forced colors (emulated), Tab order with 2 px focus outline and names on every stop, skip link first, search filter and live count, accessibility-tree names, reduced motion, no-JS. The earlier "closed at launch" block did not recur; the harness had a server crash on any missing file, now fixed. |
| Keyboard and focus (automated) | PASS | Tab order, visible 2 px outline and accessible names on every stop, skip link as first stop. |
| Forced colors | PASS (emulated) / NOT TESTED (real Windows High Contrast) | Check found the home page button lost its boundary; fixed with a `forced-colors` border. Emulation is Chromium's, not a Windows contrast theme. |
| Screen reader (NVDA, Narrator, VoiceOver) | NOT TESTED | No screen reader is installed here. Accessibility-tree names are checked, which is not speech output. Requires a human. |
| Real browser zoom (200%/400%), manual keyboard walk-through | NOT TESTED | Reflow at equivalent viewport widths passes; actual zoom and a human pass over focus and table scrolling remain manual. |
| Plugin icons | DEFERRED (non-blocking for local use) | Six ICON_MISSING directory warnings. The validator says the first icon submitted to the developer portal becomes the listing icon and later changes do not replace it, so artwork is a one-time brand choice for the owner. No placeholder art was generated. Required only before directory submission. |
| npm artifact | FIXED / PASS | Two defects found and fixed. (1) Earlier: `.claude-plugin/marketplace.json` was missing, so packed `modspack validate` crashed. (2) This pass: the tarball held 55 files and **no guard hook modules or `scripts/`** because bare `mods/*/hooks` patterns in `files` are not expanded by npm. Now 82 files; the artifact test compares every file under each mod's `hooks` and `scripts` with the tarball and was shown to fail on the old `package.json`. `npm pack --dry-run` confirms `dist/modspack.mjs` (bin), README, LICENSE, CHANGELOG, catalog, schema, docs, all six plugin manifests, agents, 12 skills; no tests, sources or `node_modules`. |
| Public npm registry | CHECKED | Registry returned E404 for `one-small-modspack`; no existing public package was found. This does not prove ownership or reserve the name. |
| Dependency audit | BLOCKED (npm endpoint) / SUBSTITUTE PASS | `npm audit --json --fetch-retries=1 --fetch-timeout=60000` failed again after 60 s: `network timeout` at `/-/npm/v1/security/advisories/bulk`. This is a network/endpoint failure, not zero vulnerabilities. Registry packument fetch (200, 0.7 s) and api.github.com worked, while a one-package POST to the same advisories endpoint also hung, so it is endpoint-side. Substitute: OSV.dev `querybatch` over all 67 locked packages returned no advisories. Not equivalent to `npm audit`; rerun `npm audit` when the endpoint responds. The package has zero runtime dependencies (devDependencies only). |
| Node 20 (`engines`) | PARTIAL PASS | Node 20.20.2: the 77 tests outside `site` and `package` pass, and the built CLI runs `validate`, `init` for all four platforms and `uninstall`; `doctor` output is identical to Node 26. `site.test.mjs` cannot load on Node 20 (jsdom's undici needs a newer zlib; dev-only) and the artifact test needs a Node bundled with npm. CI runs Node 22 only. |

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
- [x] Automated keyboard, skip link, search and focus-visibility checks on the final generated site in two browsers. Manual table-scrolling walk-through remains.
- [ ] Complete screen-reader headings/landmarks, search announcements and decorative-icon review with NVDA and a supported browser.
- [ ] Complete actual 200%/400% browser zoom, text spacing and Windows forced-colors review; record browser/AT versions and results.
- [ ] Obtain a successful `npm audit` response (OSV.dev substitute found nothing, but it is not the same tool).
- [ ] Verify Codex hooks after project trust, and Copilot/Gemini in installed authenticated runtimes; otherwise explicitly accept those integrations as experimental with unverified enforcement before release.
- [ ] Choose icon artwork before any plugin-directory submission (first submitted icon is permanent), or explicitly defer directory listing. Not needed for local use.
- [x] Package contents reviewed (82 files, listed above).
- [ ] Review final PR CI on the new commit and npm ownership/access immediately before an authorized release. Consider adding Node 20 to the CI matrix to back the `engines` claim.
- [ ] Obtain explicit authorization for merge, tagging, publishing and deployment.

The release remains a draft until the blocking checks above are completed or an
explicit, documented scope decision defers the unverified integrations. Manual
accessibility and vulnerability-audit gaps remain open; no blanket PASS is implied.
