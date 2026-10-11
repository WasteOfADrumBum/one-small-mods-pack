# guardrail-mods

Four [Claude Code mods](https://code.claude.com/docs/en/plugins/mods) that hold Claude to your project's rules while it works. Each mod is its own plugin under [`mods/`](mods), written in TypeScript, and the repository is a plugin marketplace named `guardrail-mods`.

| Mod | What it does | Event it hooks |
| :-- | :-- | :-- |
| [`wcag-enforcer`](mods/wcag-enforcer) | After a Write or Edit to `.tsx`, `.jsx`, `.html`, `.vue` or `.css`, runs eslint-plugin-jsx-a11y, axe-core and a WCAG 2.2 AA contrast check, and hands Claude each failure with file, line and rule | `tool.call` (after the tool runs), `classic.Stop` |
| [`design-guardrail`](mods/design-guardrail) | Before a Write or Edit to a UI file, blocks hardcoded hex/rgb/hsl colors and px spacing and font values, naming the design token to use | `tool.call` (before the tool runs) |
| [`qa-gate`](mods/qa-gate) | When Claude tries to finish a turn after editing code, runs the `lint`, type check, spell check and `test` scripts in `package.json` and keeps Claude working until they pass | `tool.call`, `classic.Stop` |
| [`secret-scrubber`](mods/secret-scrubber) | Redacts API keys, tokens, passwords, `.env` values and private keys from tool output before Claude reads it, with a running count in the status line | `session.append` (tool results), `tool.call` |

Built and type-checked against the declarations of **Claude Code 2.1.296** (vendored in [`types/claude-code.d.ts`](types/claude-code.d.ts)), using only events and APIs that build declares. Mods need Claude Code 2.1.287 or later; `qa-gate`'s package manager picker needs 2.1.271 or later.

## Install

Mods are code that runs with your permissions. Read them first: `claude plugin validate mods/<mod>` lists every event a mod hooks and every call it makes.

In a Claude Code session in your terminal, add the marketplace once and install the mods you want:

```text
/plugin marketplace add WasteOfADrumBum/one-small-mods-pack
/plugin install wcag-enforcer@guardrail-mods
/plugin install design-guardrail@guardrail-mods
/plugin install qa-gate@guardrail-mods
/plugin install secret-scrubber@guardrail-mods
```

Or install one mod in a single line, answering `y` to add the marketplace and then picking a scope:

```text
/plugin install secret-scrubber --marketplace WasteOfADrumBum/one-small-mods-pack
```

From your shell instead: `claude plugin marketplace add WasteOfADrumBum/one-small-mods-pack`, then `claude plugin install <mod>@guardrail-mods`, then `/reload-plugins` in any open session.

To try a mod from a clone without installing it, start Claude Code with `claude --plugin-dir ./mods/<mod>` (repeat the flag for several).

### What each mod needs in your project

| Mod | Needs |
| :-- | :-- |
| `wcag-enforcer` | For components: ESLint with `eslint-plugin-jsx-a11y` (or `eslint-plugin-vuejs-accessibility` for `.vue`) turned on in your ESLint config. For HTML: `npm i -D axe-core jsdom`. The contrast check needs nothing. A missing tool is skipped with one toast. |
| `design-guardrail` | A tokens file, `design-tokens.json` by default. Without one it steps aside with one toast. |
| `qa-gate` | A `package.json` with any of the scripts it looks for. |
| `secret-scrubber` | Nothing. |

## Configure

Every mod has two layers of settings, and the second wins:

1. **Plugin options**, set in `/config` or when you install, stored under `pluginConfigs` in your settings: `enabled` (on/off), `configFile` (the path of layer 2), and each mod's own path options (`tokensFile`, `packageJson`, `patternsFile`, ...).
2. **A project config file**, `.claude/guardrail-mods/<mod>.json` by default, checked in with the project so the whole team gets the same rules. It takes every option plus the lists. Each mod's `config.example.json` shows every key.

```json
// .claude/guardrail-mods/design-guardrail.json
{ "tokensFile": "src/styles/tokens.css", "ignore": ["**/*.stories.tsx"] }
```

| Mod | Options (`/config`) | Extra keys in the project file |
| :-- | :-- | :-- |
| `wcag-enforcer` | `enabled`, `configFile`, `extensions`, `eslintCommand`, `blockStopUntilFixed` | `eslint`, `eslintRulePrefixes`, `axe`, `nodeCommand`, `contrast`, `timeoutMs` |
| `design-guardrail` | `enabled`, `configFile`, `tokensFile`, `extensions`, `ignore` | `allow`, `maxReported` |
| `qa-gate` | `enabled`, `configFile`, `packageJson`, `packageManager`, `maxAttempts` | `checks`, `scripts`, `codeExtensions`, `timeoutMs` |
| `secret-scrubber` | `enabled`, `configFile`, `patternsFile`, `showToast` | `disabledRules`, `patterns` |

## Demos

### wcag-enforcer

Claude writes `Card.tsx` with `<img src="hero.png" />` and `note.css` with `.note { color: #aaaaaa; background: #ffffff; }`. Each tool result comes back with a note Claude reads before its next step:

```text
wcag-enforcer: 1 accessibility failure (WCAG 2.2 AA) in src/Card.tsx. Fix every one before moving on:
- src/Card.tsx:3:5 [jsx-a11y/alt-text] img elements must have an alt prop, either with meaningful text, or an empty string for decorative images.

wcag-enforcer: 1 accessibility failure (WCAG 2.2 AA) in note.css. Fix every one before moving on:
- note.css:1 [wcag/contrast-minimum] text #aaaaaa on #ffffff has contrast 2.32:1; WCAG 2.2 AA (1.4.3) needs 4.5:1
```

The status line shows `♿ 2 WCAG failures in 2 files` until they're fixed. If Claude tries to finish with failures still open, the mod sends it back with the list (twice at most, then it lets the turn end with a toast). In a test run, Claude changed the color to `#767676` (4.54:1) on its own.

HTML files go through axe-core in jsdom (`mods/wcag-enforcer/scripts/axe-check.mjs`), reported as `[axe/image-alt]`, `[axe/html-has-lang]` and so on, with line numbers. jsdom does no layout, so axe's own contrast rule is off and the mod's contrast check covers it: literal color pairs in CSS rules, `style=""` attributes and JSX style objects, with `var(--x)` resolved when the file defines `--x`, and 3:1 for large text.

### design-guardrail

With this `design-tokens.json`:

```json
{ "color": { "brand": { "$value": "#3366ff" } }, "space": { "3": "12px" } }
```

Claude tries to write `.card { color: #3366ff; padding: 13px; }`. The Write is refused, and Claude reads:

```text
design-guardrail: this Write to src/card.css hardcodes 2 values that should be design tokens (from design-tokens.json):
- line 1: `#3366ff` → use `color.brand` (`var(--color-brand)`).
- line 1: padding `13px` is not a token value → use the nearest token, `space.3` (`var(--space-3)`) = 12px.
Replace each with the token named and retry. A value that truly must stay can be kept with a `guardrail-ignore` comment on its line.
```

It retries with `.card { color: var(--color-brand); padding: var(--space-3); }`. The tokens file can be JSON (nested, W3C `$value` or Style Dictionary `value` leaves) or a CSS, SCSS or Less file of variables. It catches hex, `rgb()`, `hsl()`, px in spacing and font properties, React style numbers (`marginTop: 12`) and Tailwind arbitrary values (`p-[10px]`, `text-[#f00]`). An Edit is judged only on the values it adds, so legacy values already in a file don't block unrelated edits.

### qa-gate

Claude edits `src/a.ts` and tries to finish. The gate runs `npm run --silent lint`, `typecheck`, `spellcheck` and `test` (whichever exist; npm's placeholder `test` is skipped) with `CI=true`, and when one fails Claude reads:

````text
qa-gate: 1 check failed after your code changes. Fix the errors below, then finish:

### typecheck (`npm run --silent typecheck` exited 2)
```
src/a.ts(3,14): error TS2322: Type 'string' is not assignable to type 'number'.
```
````

The status line tracks it: `🧪 qa-gate: running typecheck…`, then `❌ qa-gate: typecheck failed` or `✅ qa-gate: 3/3 passed`. A turn that changed no code is never held. After `maxAttempts` holds in a row (3 by default) it lets the turn end with a toast. pnpm, yarn and bun are picked from the lockfile.

### secret-scrubber

Claude reads `.env.local`, then runs a script that prints a token. What Claude reads is:

```text
PORT=[REDACTED:env-value]
DATABASE_URL=[REDACTED:env-value]
```

```text
Using token [REDACTED:github-token] for api.github.com
```

The status line keeps a running count (`🔒 3 secrets redacted`) and a toast says what was caught. It covers private key blocks, JWTs, GitHub, Google (API keys, OAuth tokens, client secrets), AWS (key IDs and secret keys), Vercel, Todoist, Slack, Stripe, Anthropic and OpenAI keys, Bearer tokens, credentials in URLs, every value of a `.env` file Claude reads, and generic `password=`, `api_key:`, `"secret": "..."` pairs whose value looks like a secret (code like `token = getToken()` is left alone). Add your own with `patterns`. Your terminal still shows the real output; only what Claude reads is scrubbed. If the scan itself fails, the output is withheld from Claude rather than passed through.

## How they fail

- `design-guardrail` fails open: if the guard itself errors, the edit goes ahead.
- `secret-scrubber` fails closed: if scrubbing errors, Claude gets a placeholder instead of the output.
- `wcag-enforcer` and `qa-gate` never hold a turn forever (two and `maxAttempts` holds in a row).

## Develop

```bash
npm run typecheck   # tsc against types/claude-code.d.ts (Claude Code 2.1.296)
npm run validate    # claude plugin validate on the marketplace and each mod
npm test            # claude plugin test in each mod
```

Each mod's tests live in `mods/<mod>/tests/` and use `claude-code/testing`: they raise the events the mod hooks and stub every file, process and display call beneath it, covering pass and fail cases. To type-check against a different Claude Code build, replace `types/claude-code.d.ts` with the one that build writes beside a mod it loads (`.claude-plugin/types/claude-code/index.d.ts`).

## License

[MIT](LICENSE)
