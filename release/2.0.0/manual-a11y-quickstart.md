# Manual accessibility pass: quick start (Windows 11, PowerShell 7)

For the 12 website rows (A1–A5, Z1–Z2, T1, H1, K1–K3) of
[`manual-acceptance.md`](manual-acceptance.md). Budget about 45 minutes. The automated checks
already pass (CI `site` job, `npm run site:check`); this pass is what automation cannot judge.
Record PASS, FAIL or DEFERRED-BY-OWNER per row; an agent never fills these in for you.

## 1. Open the site (about 2 minutes)

The site is identical at `b0ff54a` and the current `main` (no site or docs change since).

```powershell
cd $HOME
git clone https://github.com/WasteOfADrumBum/one-small-mods-pack.git   # skip if you have a clone
cd one-small-mods-pack
git switch main; git pull
npm ci
npm run site
npx --yes http-server site/dist -p 8080 -c-1
```

Leave that window running, then in a second PowerShell window:

```powershell
Start-Process msedge http://localhost:8080/
```

Install NVDA if you do not have it: `winget install --id NVAccess.NVDA -e`.

## 2. Checklist

1. **Keyboard (K1–K3, about 5 min).** Reload `index.html`, press Tab: the first stop is "Skip to main
   content"; Enter moves focus to main; every stop has a visible outline. On `compatibility.html`,
   Tab to the wide table and scroll it with the arrow keys. On `skills.html`, type in the filter,
   then Tab into the results: focus is never lost or trapped.
2. **Screen reader (A1–A4, about 15 min).** Start NVDA (Ctrl+Alt+N). On `index.html` press H to step
   through headings (one H1 "One Small ModsPack") and D through landmarks (banner, navigation, main,
   contentinfo); the skip link is announced first. On `skills.html` type in the filter: the field
   has a spoken label and the result count change is announced. On `compatibility.html` move into
   the table and use Ctrl+Alt+arrows: row and column headers are read with each cell. On
   `agents.html` and `guards.html` decorative icons are silent or read once. Quit NVDA with
   Insert+Q. (Narrator instead: Win+Ctrl+Enter.)
3. **A5 VoiceOver.** Only if you have a Mac or iPhone; otherwise mark `DEFERRED-BY-OWNER` with
   "no Apple device".
4. **Real zoom (Z1–Z2, about 8 min).** In Edge, on `index.html`, `compatibility.html` and
   `docs-release-verification.html`: Ctrl+Plus to 200%, then to 400% (Ctrl+0 resets). Nothing is cut
   off or overlaps; at 400% content is one column and only wide tables scroll sideways, inside their
   own box.
5. **Text spacing (T1, about 3 min).** On `getting-started.html` press F12, open Console, paste this
   and press Enter. No text may be clipped or overlap:

   ```js
   document.querySelectorAll('*').forEach(e => { const s = e.style; s.setProperty('line-height', '1.5', 'important'); s.setProperty('letter-spacing', '0.12em', 'important'); s.setProperty('word-spacing', '0.16em', 'important') }); document.querySelectorAll('p').forEach(p => p.style.setProperty('margin-bottom', '2em', 'important'))
   ```

6. **Windows contrast themes (H1, about 5 min).** Left Alt + Left Shift + Print Screen toggles a
   contrast theme, or Settings > Accessibility > Contrast themes > Night sky, then Desert. On
   `index.html` and `skills.html`, links, buttons, the focus outline and the filter field stay
   visible with boundaries. Turn the theme off afterwards.

## 3. Record the results

Either reply in the project thread with one line per row (for example `K1 PASS`, `Z2 FAIL: table
overlaps footer at 400%`), and an agent transcribes them with a pointer to your message, or edit the
file yourself:

```powershell
git switch -c release/2.0.0-acceptance
notepad release\2.0.0\manual-acceptance.md
```

Set each Result, add a short note in Evidence, and replace the last line with your own sign-off,
for example `Owner sign-off: Joshua Small on 2026-11-05`. Only you write that line. Then:

```powershell
git commit -am "Record 2.0.0 manual acceptance"
git push -u origin release/2.0.0-acceptance
gh pr create --fill --base main
```

Merge it once CI is green. That merge commit is the release candidate (`release/` is not shipped,
so the package does not change).
