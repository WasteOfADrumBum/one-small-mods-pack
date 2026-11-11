# One Small ModsPack: roadmap

Optional, future work. **Nothing here blocks the 2.0.0 release**, and nothing here reopens it.
Defects in shipped behaviour are fixes, not roadmap items. The 2.0.0 release state lives in
[`release/2.0.0/tracker.md`](release/2.0.0/tracker.md); its manual gates in
[`release/2.0.0/manual-acceptance.md`](release/2.0.0/manual-acceptance.md).

An item enters a release only when the owner (Joshua Small) adds it to an approved scope.
Priority: **P1** worth doing next, **P2** useful, **P3** nice to have.

## Enhancements

### R1. Plugin icon artwork and plugin-directory submission (P2)

- **Why:** `claude plugin validate` warns ICON_MISSING for all six plugins. Only a plugin directory
  listing needs icons; npm and local installs do not.
- **Done when:** each plugin has an icon the validator finds, and the owner decides whether to submit.
- **Needs:** artwork (owner).

### R2. Live enforcement evidence for Codex, Copilot and Gemini CLI (P1)

- **Why:** 2.0.0 ships these integrations with live discovery evidence only; hook enforcement,
  custom agents and model use are documented as unverified (`docs/limitations.md`).
- **Done when:** in a signed-in session per tool, a guarded write is denied by the ModsPack hook and
  an agent loads (rows P1–P3 of the manual acceptance record), and `catalog/compatibility.json` is
  updated from that evidence.
- **Needs:** the owner's signed-in Codex, Copilot and Gemini accounts.

### R3. Record Claude Code agent loading in the catalog (P2)

- **Why:** on 2026-11-04 Claude Code 2.1.318 loaded all six modspack-agents and delegated to one
  (`release/2.0.0/verification-2026-11-04.md`), but `catalog/compatibility.json` still lists
  Claude Code `custom-agents` and `agent-delegation` as `partial`. Changing a shipped file would
  change the 2.0.0 tarball, so this waits for the next version.
- **Done when:** the catalog and README cite that evidence in a 2.0.x release.

### R4. Mod typecheck in CI (P3)

- **Why:** `npm run typecheck` needs Claude Code's own declarations, which are not redistributed,
  so CI cannot run it today; it is run by hand (last: 2026-11-04, 0 errors).
- **Done when:** a CI job obtains the declarations from the pinned Claude Code build without
  committing them, or the owner accepts the manual step.

### R5. Optional hosting of the documentation site (P3)

- **Why:** the owner chose Vercel on 2026-11-11; `vercel.json` builds the site and Vercel deploys `main`.
- **Done when:** the Vercel production deployment serves the site.
