# Getting started

ModsPack gives your AI coding tool a shared set of agent roles, skills and guards, and gives your CI the same checks without any AI model.

## Terms

- **Agent**: a specialised AI role that performs or evaluates work, such as Sentinel the code reviewer. It has a friendly display name, a stable technical ID and a fixed tool allowance (see [agent names](agent-names.md)).
- **Skill**: reusable instructions for performing one workflow, in the open Agent Skills format (`SKILL.md`), shared by all four tools.
- **Mod or guard**: an automated mechanism that evaluates or enforces rules. Some run as hooks while an AI tool works, all run from the CLI.
- **Hook**: a command the AI tool runs before or after a tool call. Hooks here fail open and are a convenience, not the enforcement point.
- **CLI check**: a deterministic `modspack` command. It needs no AI model and no network.
- **Release gate**: a group of required checks (quality, security, privacy, accessibility, package) that `modspack release-check` turns into READY or NOT READY.

## Try it without changing anything

These `npx` commands need the package on npm. If npm reports `one-small-modspack` as not found, it has not been published yet: use the clone or tarball steps under "Install for your tools".

```text
npx one-small-modspack inspect
npx one-small-modspack init
```

`inspect` is read-only. `init` prints what it would write and writes nothing until you add `--yes`. It never overwrites a file it did not create, and it merges into `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` inside a marked block so your own instructions stay as they are.

## Install for your tools

Install it in the target project first. Hooks use
`npx --no-install modspack`, so a one-off `npx one-small-modspack init` does not
provide the local executable the hooks need.

```text
npm install --save-dev one-small-modspack
```

```text
npx one-small-modspack init --platform codex --yes
npx one-small-modspack init --platform copilot,gemini --yes
npx one-small-modspack init --platform claude-code --yes
```

If the package is not on npm yet, run it from a clone: `npm ci && npm run build && node dist/modspack.mjs init`.

For a pre-release integration test, run `npm pack` in the clone, then install the
resulting `.tgz` in a disposable project with `npm install --save-dev <path-to-tgz>`.
Run `npx --no-install modspack init --platform codex --yes` there. This exercises
the shipped package and gives its hooks a local executable without publishing.

For Claude Code you can also install the mods as plugins from the `guardrail-mods` marketplace. See the repository README.

## Use it

- Ask your tool to use a skill by name, for example "use the release-readiness skill".
- Run `modspack release-check` before a release. It prints READY or NOT READY and, when not ready, the smallest steps to get there.
- Add `--ci` to `init` to get a GitHub Actions workflow that runs the same command.

## Update and uninstall

Run `init` again to update; files you edited are kept and reported. `modspack uninstall --yes` removes only what `init` installed, using the manifest in `.modspack/manifest.json`.
