# 2.0 pre-release verification

Checkpoint: 2026-10-22, America/New_York (third pass, on top of `0c3bb56`; earlier passes 2026-10-21 on `1c372fa` and `559d010`). **NO-GO for release** until the manual items below are done or an explicit scope decision defers them; the owner deferred the manual items on 2026-10-29 (see Scope decision), so website deployment and publishing remain NO-GO.
No merge, tag, npm publication or deployment was performed.

## Scope decision (2026-10-29, owner)

The owner postponed the manual testing and asked to finish the work. Nothing below was run or marked passed because of that. The deferred items stay NOT TESTED in the table:

- Screen reader review (NVDA, Narrator, VoiceOver), real browser zoom, text spacing and Windows High Contrast, and a human keyboard and table-scrolling pass over the website.
- Interactive `/hooks` trust confirmation in Codex.
- Copilot and Gemini runtime enforcement and custom agents (not installed or authenticated where this was verified); these integrations stay documented as unverified.
- Plugin icon artwork (deferred; needed only for directory submission).

All automated work is complete and CI is green (cli, mods, windows). What the deferral changes: the code can be reviewed and merged on its automated evidence. The **website must not be deployed, and the npm package must not be published or described as accessibility-verified, until the manual accessibility items are done.** The merge, the tag, the publication and the deployment each still need the owner's explicit authorization, and npm ownership and access must be confirmed immediately before publishing.

## Evidence and status

| Area | Status | Evidence and limit |
| --- | --- | --- |
| Baseline CLI checks | PASS (historical) | `npm run check`: 84 CLI tests, shared files, CLI typecheck, plugin validation and 131 mod tests passed on Windows. |
| Final checks after fixes | PASS | Third pass `npm run check` (exit 0): 89 CLI tests, 131 mod tests (35 + 29 + 24 + 20 + 23), shared files, CLI typecheck, and `claude plugin validate` on all six plugins with 0 errors (only the six ICON_MISSING warnings). Windows, Node 26.12.0, npm 11.20.0, Claude Code 2.1.307. Earlier passes: 84 and 86 CLI tests. |
| Five guard mods, primary live behavior | PASS (prior user-reported evidence) | The handoff reports all five passing. Recovered QA Gate transcript shows automatic PASS → FAIL → PASS, Stop enforcement, no extra run on the no-change turn, and cleanup. Recovered WCAG transcript shows contrast, axe and Stop enforcement. This run did not repeat every live guard test. |
| WCAG ESLint live path | PASS | Claude Code 2.1.307, ESLint 9.39.5 and jsx-a11y 6.10.2 in an isolated JSX fixture. A real Edit removed `alt`; automatic hook context reported `Fixture.jsx:1:44 [jsx-a11y/alt-text]`. A real Edit restored it and emitted no finding; the turn completed. An independent final ESLint run returned exit 0. No manual ESLint command substituted for the failing edit's automatic hook. |
| WCAG ESLint Stop enforcement | NOT RETESTED | The new test fixed the violation within the turn. Separate-turn Stop evidence is from the earlier contrast test, not this JSX test. |
| Codex instruction and skill discovery | PASS | Installed Codex 0.159.3: `debug prompt-input` succeeded, and a real read-only `exec` session identified the ModsPack block and all 12 skill names. No skill execution, custom agent invocation or hook denial is inferred from discovery. |
| Codex hook enforcement | PASS with trust bypassed; untrusted = silent no-op (live, 2026-10-22) | Codex 0.159.3 (`hooks` feature stable), throwaway fixture from the packed tarball. **Earlier "failure" was a bad fixture:** `AKIAIOSFODNN7EXAMPLE` contains `EXAMPLE`, which the hook deliberately treats as a placeholder (`PLACEHOLDER` in `src/commands/hook.ts`), so it was allowed by design. Detector controls: that key allowed, synthetic `AKIAJ7Q2M4X9B5N3R6TW` denied. Live positive control with `--dangerously-bypass-hook-trust`: Codex logged `Command blocked by PreToolUse hook: ModsPack blocked this apply_patch: - a aws-access-key-id [masked, 20 chars]`, the model reported the block, and `secret.txt` was not created. Live control without trust: the same patch was applied and `secret.txt` was written; Codex gave no hook warning. So the hook fires and enforces only once trusted, and an untrusted hook fails silently. Not tested: interactive `/hooks` trust persistence, Edit/Write tools, shell writes (never judged). No ModsPack code defect; regression test added and docs state the trust requirement. |
| Copilot / Gemini runtime | NOT TESTED | Rechecked 2026-10-22: neither `copilot` nor `gemini` is on PATH, and no authenticated session exists to test against. Earlier discovery-only results remain historical evidence. Hooks are validated only with recorded payloads (static). No runtime or model-use claim is added. |
| Site structure, names, links, source consistency | PASS | Existing CLI suite includes generated-site jsdom/axe and link/definition checks. This is not a manual accessibility review. |
| Site real-browser automation | PASS | Rerun 2026-10-22 on the final generated site, 18 pages, both Playwright Chromium 1243 and Edge (`PASS: 18 pages: axe incl. contrast in light and dark, 200% and 400% zoom, text spacing, forced colors (emulated), keyboard focus order and indicators, search, accessibility tree names, reduced motion, no-JS`). Playwright 1.64.1 was installed outside the repo (scratchpad) and located with `NODE_PATH`; the script finds only a global Playwright by default. 200%/400% are viewport-width equivalents, not browser zoom. |
| Keyboard and focus (automated) | PASS | Tab order, visible 2 px outline and accessible names on every stop, skip link as first stop. |
| Forced colors | PASS (emulated) / NOT TESTED (real Windows High Contrast) | Check found the home page button lost its boundary; fixed with a `forced-colors` border. Emulation is Chromium's, not a Windows contrast theme. |
| Screen reader (NVDA, Narrator, VoiceOver) | NOT TESTED | No screen reader is installed here. Accessibility-tree names are checked, which is not speech output. Requires a human. |
| Real browser zoom (200%/400%), manual keyboard walk-through | NOT TESTED | Reflow at equivalent viewport widths passes; actual zoom and a human pass over focus and table scrolling remain manual. |
| Plugin icons | DEFERRED (non-blocking for local use) | Six ICON_MISSING directory warnings, rechecked; the repository holds no image assets, so there is no project-owned artwork to use. The validator says the first icon submitted to the developer portal becomes the listing icon and later changes do not replace it, so artwork is a one-time brand choice for the owner. No placeholder art was generated. Required only before directory submission. |
| npm artifact | FIXED / PASS | Two defects found and fixed. (1) Earlier: `.claude-plugin/marketplace.json` was missing, so packed `modspack validate` crashed. (2) This pass: the tarball held 55 files and **no guard hook modules or `scripts/`** because bare `mods/*/hooks` patterns in `files` are not expanded by npm. Now 82 files; the artifact test compares every file under each mod's `hooks` and `scripts` with the tarball and was shown to fail on the old `package.json`. `npm pack --dry-run` confirms `dist/modspack.mjs` (bin), README, LICENSE, CHANGELOG, catalog, schema, docs, all six plugin manifests, agents, 12 skills; no tests, sources or `node_modules`. |
| Public npm registry | CHECKED | Registry returned E404 for `one-small-modspack`; no existing public package was found. This does not prove ownership or reserve the name. |
| Plugin and package versions | FIXED / PASS | Third pass found `design-guardrail`, `qa-gate`, `secret-scrubber` and `wcag-enforcer` still at 0.1.0 although their hook code differs from `main`. Claude Code updates an installed plugin only when the version changes, so existing installs would never get the fixes. Bumped to 0.1.1 (patch: robustness and Windows fixes, no feature change); `privacy-guard` and `modspack-agents` stay 2.0.0. `CHANGELOG.md` has a `Mod versions` list and `test/release-docs.test.mjs` fails if a plugin version, the changelog, the package heading or the marketplace membership disagree (shown to fail on a stale 0.1.0). |
| Release docs and claims | PASS | README, CHANGELOG and `docs/limitations.md` reviewed. Install, update and `modspack uninstall --yes` instructions exist (`docs/getting-started.md`). The README and CHANGELOG said Codex runtime was wholly NOT TESTED while discovery had live evidence; reworded to the evidence actually held (Codex discovery only; hook enforcement NOT TESTED). Compatibility statuses come from `catalog/compatibility.json`. |
| Dependency audit | PASS | Third pass: `npm audit --json --fetch-retries=1 --fetch-timeout=120000` exited 0 in 1.5 s: 0 vulnerabilities across 67 locked packages (info/low/moderate/high/critical all 0); `npm audit --omit=dev` also 0; `npm audit signatures` verified 17 packages with attestations. Two earlier attempts failed with `network timeout` at `/-/npm/v1/security/advisories/bulk`; that was the endpoint, not a finding, and the OSV.dev substitute then found nothing either. The package has zero runtime dependencies (devDependencies only). |
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
- [ ] (postponed by owner 2026-10-29; blocks website deployment and any accessibility claim) Complete screen-reader headings/landmarks, search announcements and decorative-icon review with NVDA and a supported browser.
- [ ] (postponed by owner 2026-10-29; same) Complete actual 200%/400% browser zoom, text spacing and Windows forced-colors review; record browser/AT versions and results.
- [x] Obtain a successful `npm audit` response (0 vulnerabilities, 2026-10-22).
- [x] Codex hook enforcement verified live with trust bypassed (2026-10-22); [ ] confirm once through interactive `/hooks` trust (manual), and Copilot/Gemini in installed authenticated runtimes; otherwise explicitly accept those integrations as experimental with unverified enforcement before release.
- [ ] Choose icon artwork before any plugin-directory submission (first submitted icon is permanent), or explicitly defer directory listing. Not needed for local use. (Deferred by owner 2026-10-29.)
- [x] Package contents reviewed (82 files, listed above; rerun third pass).
- [x] Plugin versions bumped where hook code changed, with a consistency test.
- [x] Final PR CI on `9e79b0b`: cli, mods, windows all passed (run 39808719131).
- [ ] Confirm npm ownership/access immediately before an authorized release. Consider adding Node 20 to the CI matrix to back the `engines` claim.
- [ ] Obtain explicit authorization for merge, tagging, publishing and deployment.

The release remains a draft until the blocking checks above are completed or an
explicit, documented scope decision defers the unverified integrations. Manual
accessibility and vulnerability-audit gaps remain open; no blanket PASS is implied.
