// modspack: install the ModsPack agents, skills and guards into a project,
// and run its deterministic checks. Exit codes: 0 ok, 1 a gate failed (or
// NOT READY), 2 usage or config error, 3 a required check could not run.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { renderAll } from './adapters/render'
import { accessibilityGate, designGate, qualityGate } from './checks/project'
import { privacyGate, securityGate } from './checks/gates'
import { releaseCheck } from './checks/release'
import { inspect, renderInspection } from './commands/inspect'
import { runHook } from './commands/hook'
import { ConfigError, loadConfig, PLATFORMS } from './core/config'
import type { ModspackConfig, Platform } from './core/config'
import { loadAgents, loadSkills } from './core/definitions'
import type { DefinitionProblem } from './core/definitions'
import { DEFINITIONS_ROOT, PACKAGE_ROOT } from './core/paths'
import { renderMarkdown, renderText, writeReports } from './core/render'
import { EXIT, exitCode } from './core/report'
import type { GateResult } from './core/report'
import { validatePackage } from './core/validate-package'
import { apply, applyUninstall, doctorRows, plan, planUninstall, readManifest } from './install/install'

export type Io = { out: (text: string) => void; err: (text: string) => void; cwd: string; stdin?: () => Promise<string> }

const VERSION = (JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version: string }).version

const HELP = `modspack ${VERSION}: AI development agents, skills and guards for Claude Code, Codex, Copilot and Gemini CLI

Usage: modspack <command> [options]

Install
  inspect         what the project is and what AI configuration it already has (read-only)
  init            preview, then install agents, skills, hooks and instructions (--yes to apply)
  doctor          check an installation is present, unmodified and usable
  uninstall       remove what init installed, and only that (--yes to apply)

Checks (deterministic; no AI model, no network unless stated)
  check           run the project's lint, typecheck, spellcheck, test and build scripts
  security        committed secrets (tree and history), CI and supply-chain risks, client exposure
  privacy         personal and health data; HIPAA-related review when it applies
  accessibility   contrast, axe-core and jsx-a11y; lists the manual checks still needed
  release-check   all required gates, then READY or NOT READY

Reference
  agents          list the agent roles
  skills          list the skills
  validate        validate the shipped definitions, schema and catalogs
  hook <platform> pre-write guard for codex, copilot or gemini (reads the tool call from stdin)

Options
  --dir <path>        project directory (default: the current directory)
  --json              print JSON
  --write             also write Markdown and JSON reports to report.dir (.modspack/reports)
  --advisory          report only: exit 0 even when a gate fails (a required check that could not run still exits 3)
  --verbose           list every finding, informational ones included
  --platform <list>   init/uninstall: claude-code,codex,copilot,gemini (default: detected, else all)
  --skill <list>      init: only these skills      --agent <list>   init: only these agents
  --ci                init: add a GitHub Actions workflow running release-check
  --standalone        init: also write Claude Code agents and skills into .claude/ (when not using the plugin)
  --yes               init/uninstall: apply the change (without it nothing is written)
  --history           privacy: also scan git history       --no-history   security: skip the history scan
  --audit-deps        security: run npm audit (sends the dependency list to the registry)
  --user              inspect: also list ~/.claude, ~/.codex, ~/.gemini, ~/.copilot, ~/.agents
  -h, --help   -v, --version

Exit codes: 0 ok, 1 a gate failed or NOT READY, 2 usage or config error, 3 a required check could not run.`

export class UsageError extends Error {}

export type Args = { command: string | undefined; flags: Record<string, string | boolean>; lists: Record<string, string[]>; positional: string[] }

const LIST_FLAGS = new Set(['platform', 'skill', 'agent'])
const VALUE_FLAGS = new Set(['dir', 'platform', 'skill', 'agent'])

export function parseArgs(argv: readonly string[]): Args {
  const flags: Record<string, string | boolean> = {}
  const lists: Record<string, string[]> = {}
  const positional: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (arg === '-h') flags.help = true
    else if (arg === '-v') flags.version = true
    else if (arg === '-y') flags.yes = true
    else if (arg.startsWith('--')) {
      const [name = '', inline] = arg.slice(2).split(/=(.*)/s, 2)
      if (VALUE_FLAGS.has(name)) {
        const value = inline ?? argv[i + 1]
        if (inline === undefined) i += 1
        if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`)
        if (LIST_FLAGS.has(name)) (lists[name] ??= []).push(...value.split(',').map(v => v.trim()).filter(Boolean))
        else flags[name] = value
      } else flags[name] = inline ?? true
    } else positional.push(arg)
  }
  return { command: positional.shift(), flags, lists, positional }
}

const projectDir = (io: Io, args: Args) => path.resolve(io.cwd, typeof args.flags.dir === 'string' ? args.flags.dir : '.')

const policyNote = (config: ModspackConfig) =>
  `Policy: open findings at ${config.security.failOn} or above fail the gate when confirmed, and need review when likely. Dismiss one by adding its fingerprint to security.accepted in modspack.config.json with a reason.`

/** Prints gates, writes reports when asked, and returns the exit code for the mode. */
function finish(io: Io, args: Args, dir: string, config: ModspackConfig, name: string, title: string, gates: GateResult[], json: Record<string, unknown> = {}, extra: string[] = []): number {
  const mode = args.flags.advisory ? 'advisory' : config.mode
  const code = exitCode(gates, mode)
  const payload = { tool: 'modspack', version: VERSION, command: name, mode, exitCode: code, gates, ...json }
  if (args.flags.json) io.out(JSON.stringify(payload, null, 2))
  else io.out(renderText(gates, { verbose: Boolean(args.flags.verbose) }) + (extra.length > 0 ? '\n\n' + extra.join('\n') : ''))
  if (args.flags.write) {
    const written = writeReports(dir, config.report.dir, name, renderMarkdown(title, gates, extra), payload)
    if (!args.flags.json) io.out(`\nreports: ${written.map(f => path.relative(dir, f)).join(', ')}`)
  }
  return code
}

function definitions(args: Args) {
  const problems: DefinitionProblem[] = []
  const skillFilter = args.lists.skill
  const agentFilter = args.lists.agent
  const allSkills = loadSkills(DEFINITIONS_ROOT, problems)
  const allAgents = loadAgents(DEFINITIONS_ROOT, problems)
  for (const [filter, all, what] of [[skillFilter, allSkills, 'skill'], [agentFilter, allAgents, 'agent']] as const) {
    for (const name of filter ?? []) if (!all.some(d => d.name === name)) throw new UsageError(`unknown ${what} "${name}". Available: ${all.map(d => d.name).join(', ')}`)
  }
  if (problems.length > 0) throw new Error(`shipped definitions are invalid: ${problems[0]!.message}`)
  return { skills: allSkills.filter(s => skillFilter === undefined || skillFilter.includes(s.name)), agents: allAgents.filter(a => agentFilter === undefined || agentFilter.includes(a.name)) }
}

function choosePlatforms(args: Args, dir: string, fallback: readonly Platform[]): { platforms: Platform[]; note: string } {
  const named = args.lists.platform
  if (named !== undefined) {
    for (const p of named) if (!(PLATFORMS as readonly string[]).includes(p)) throw new UsageError(`unknown platform "${p}". Use: ${PLATFORMS.join(', ')}`)
    return { platforms: named as Platform[], note: 'platforms chosen with --platform' }
  }
  const { config: cfg } = loadConfig(dir)
  if (cfg.adapters !== undefined) return { platforms: cfg.adapters, note: 'platforms from modspack.config.json' }
  const found = inspect(dir)
  const detected = PLATFORMS.filter(p => found.tools[p].configured)
  if (detected.length > 0) return { platforms: detected, note: `platforms detected from existing project configuration: ${detected.join(', ')}` }
  return { platforms: [...fallback], note: 'no AI configuration detected, so all four platforms are included (narrow with --platform)' }
}

export async function main(argv: readonly string[], io: Io = { out: t => process.stdout.write(t + '\n'), err: t => process.stderr.write(t + '\n'), cwd: process.cwd(), stdin: readStdin }): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (error) {
    io.err(`modspack: ${(error as Error).message}`)
    return EXIT.usage
  }
  if (args.flags.version) {
    io.out(VERSION)
    return EXIT.ok
  }
  if (args.flags.help || args.command === undefined || args.command === 'help') {
    io.out(HELP)
    return EXIT.ok
  }
  try {
    const dir = projectDir(io, args)
    switch (args.command) {
      case 'validate': {
        const problems = validatePackage(PACKAGE_ROOT)
        if (args.flags.json) io.out(JSON.stringify({ status: problems.length === 0 ? 'PASS' : 'FAIL', problems }, null, 2))
        else if (problems.length === 0) io.out('PASS definitions, schema and catalogs are valid')
        else io.out(['FAIL', ...problems.map(p => `  ${path.relative(PACKAGE_ROOT, p.file) || p.file}: ${p.message}`)].join('\n'))
        return problems.length === 0 ? EXIT.ok : EXIT.failed
      }
      case 'agents':
      case 'skills': {
        const { agents, skills } = definitions(args)
        const rows = args.command === 'agents' ? agents.map(a => ({ name: a.name, description: a.description, tools: a.tools })) : skills.map(s => ({ name: s.name, description: s.description, category: s.metadata['modspack-category'], agent: s.metadata['modspack-agent'] }))
        io.out(args.flags.json ? JSON.stringify(rows, null, 2) : rows.map(r => `${r.name}\n  ${r.description}`).join('\n'))
        return EXIT.ok
      }
      case 'inspect': {
        const found = inspect(dir, { user: Boolean(args.flags.user) })
        io.out(args.flags.json ? JSON.stringify(found, null, 2) : renderInspection(found))
        return EXIT.ok
      }
      case 'security': {
        const { config } = loadConfig(dir)
        const { findings: _f, ...gate } = securityGate(dir, config, { history: args.flags['no-history'] ? false : undefined, auditDeps: args.flags['audit-deps'] === true ? true : undefined })
        return finish(io, args, dir, config, 'security', 'Security report', [gate], {}, [policyNote(config)])
      }
      case 'privacy': {
        const { config } = loadConfig(dir)
        const { findings: _f, hipaa, ...gate } = privacyGate(dir, config, { history: Boolean(args.flags.history) })
        const extra = hipaa.active ? ['HIPAA-related review', hipaa.disclaimer, ...hipaa.items.map(i => `- ${i.status}: ${i.area}. ${i.note}`)] : [`HIPAA-related review not active: ${hipaa.reason}.`]
        return finish(io, args, dir, config, 'privacy', 'Privacy report', [gate], { hipaa }, extra)
      }
      case 'check': {
        const { config } = loadConfig(dir)
        return finish(io, args, dir, config, 'check', 'Quality report', [qualityGate(dir, config), designGate(dir, config)])
      }
      case 'accessibility': {
        const { config } = loadConfig(dir)
        const gate = accessibilityGate(dir, config)
        return finish(io, args, dir, config, 'accessibility', 'Accessibility report', [gate], {}, ['Automated checks cover only part of WCAG 2.2 AA. Keyboard, focus order, screen reader output, zoom/reflow and reduced motion need the manual checklist in the wcag-audit skill. A clean automated run is not a conformance claim.'])
      }
      case 'release-check': {
        const { config } = loadConfig(dir)
        const result = releaseCheck(dir, config, { history: args.flags['no-history'] ? false : undefined, auditDeps: args.flags['audit-deps'] === true ? true : undefined })
        const extra = [
          `Required gates: ${result.required.join(', ')}`,
          ...(result.steps.length > 0 ? ['Minimum steps to READY:', ...result.steps.map((s, i) => `  ${i + 1}. ${s}`)] : []),
          ...(result.needsHumanReview.length > 0 ? ['Not verified by this tool (needs a person):', ...result.needsHumanReview.map(r => `  - ${r}`)] : []),
          `VERDICT: ${result.verdict}`,
        ]
        const mode = args.flags.advisory ? 'advisory' : config.mode
        const blocked = result.reasons.some(r => r.status !== 'FAIL')
        const failed = result.reasons.some(r => r.status === 'FAIL')
        const code = result.verdict === 'READY' ? EXIT.ok : failed && mode === 'enforce' ? EXIT.failed : blocked ? EXIT.blocked : EXIT.ok
        const payload = { tool: 'modspack', version: VERSION, command: 'release-check', mode, exitCode: code, verdict: result.verdict, required: result.required, reasons: result.reasons, steps: result.steps, needsHumanReview: result.needsHumanReview, gates: result.gates }
        if (args.flags.json) io.out(JSON.stringify(payload, null, 2))
        else io.out(renderText(result.gates) + '\n\n' + extra.join('\n'))
        if (args.flags.write) {
          const written = writeReports(dir, config.report.dir, 'release-check', renderMarkdown('Release readiness report', result.gates, extra), payload)
          if (!args.flags.json) io.out(`\nreports: ${written.map(f => path.relative(dir, f)).join(', ')}`)
        }
        return code
      }
      case 'init': {
        const { agents, skills } = definitions(args)
        const { platforms, note } = choosePlatforms(args, dir, PLATFORMS)
        const outputs = renderAll({ platforms, agents, skills, ci: Boolean(args.flags.ci), standalone: Boolean(args.flags.standalone) })
        const manifest = readManifest(dir)
        const actions = plan(dir, outputs, manifest)
        const summary = (['create', 'update', 'adopt', 'unchanged', 'keep-edited', 'conflict'] as const).map(op => `${actions.filter(a => a.op === op).length} ${op}`).join(', ')
        const lines = [`modspack init (${note})`, ...actions.filter(a => a.op !== 'unchanged').map(a => `  ${a.op.padEnd(11)} ${a.path}  (${a.detail})`), '', `${summary}`]
        if (!args.flags.yes) {
          lines.push('', 'Preview only: nothing was written. Re-run with --yes to apply.')
          if (platforms.some(p => p !== 'claude-code')) lines.push('The Codex, Copilot and Gemini hooks run `npx --no-install modspack`, so the project needs it as a dev dependency: npm i -D one-small-modspack')
          if (platforms.includes('claude-code')) lines.push('For Claude Code, install the guard mods from the marketplace: /plugin marketplace add WasteOfADrumBum/one-small-mods-pack')
        } else {
          apply(dir, actions, manifest, { version: VERSION, platforms })
          lines.push('', `Applied. Manifest: .modspack/manifest.json. Check with: modspack doctor`)
        }
        if (args.flags.json) io.out(JSON.stringify({ applied: Boolean(args.flags.yes), platforms, actions: actions.map(({ op, path: p, detail }) => ({ op, path: p, detail })) }, null, 2))
        else io.out(lines.join('\n'))
        return EXIT.ok
      }
      case 'uninstall': {
        const manifest = readManifest(dir)
        if (manifest === undefined) {
          io.out('Nothing to uninstall: no .modspack/manifest.json in this project.')
          return EXIT.ok
        }
        const actions = planUninstall(dir, manifest)
        const lines = ['modspack uninstall', ...actions.map(a => `  ${a.op.padEnd(12)} ${a.path}  (${a.detail})`)]
        if (!args.flags.yes) lines.push('', 'Preview only: nothing was changed. Re-run with --yes to apply.')
        else {
          applyUninstall(dir, manifest, actions)
          lines.push('', 'Removed. Files you edited were kept.')
        }
        io.out(args.flags.json ? JSON.stringify({ applied: Boolean(args.flags.yes), actions }, null, 2) : lines.join('\n'))
        return EXIT.ok
      }
      case 'doctor': {
        const manifest = readManifest(dir)
        const rows: { name: string; status: 'ok' | 'warn' | 'fail'; detail: string }[] = []
        const nodeMajor = Number(process.versions.node.split('.')[0])
        rows.push({ name: 'node', status: nodeMajor >= 20 ? 'ok' : 'fail', detail: `v${process.versions.node} (needs 20 or later)` })
        try {
          const loaded = loadConfig(dir)
          rows.push({ name: 'config', status: 'ok', detail: loaded.file ? 'modspack.config.json is valid' : 'no modspack.config.json (defaults apply)' })
        } catch (error) {
          rows.push({ name: 'config', status: 'fail', detail: (error as Error).message })
        }
        if (manifest === undefined) rows.push({ name: 'installation', status: 'warn', detail: 'no .modspack/manifest.json: nothing installed (run modspack init)' })
        else {
          for (const row of doctorRows(dir, manifest)) rows.push({ name: row.path, status: row.status === 'ok' ? 'ok' : row.status === 'edited' ? 'warn' : 'fail', detail: row.detail || row.status })
          const needsCli = Object.keys(manifest.merges).length > 0 || manifest.platforms.some(p => p === 'copilot')
          const local = existsSync(path.join(dir, 'node_modules/.bin/modspack'))
          if (needsCli) rows.push({ name: 'hook command', status: local ? 'ok' : 'fail', detail: local ? 'modspack is installed in the project' : 'hooks run `npx --no-install modspack` but it is not installed: npm i -D one-small-modspack' })
        }
        const failed = rows.some(r => r.status === 'fail')
        io.out(args.flags.json ? JSON.stringify({ status: failed ? 'FAIL' : 'PASS', rows }, null, 2) : rows.map(r => `${r.status.toUpperCase().padEnd(4)} ${r.name}: ${r.detail}`).join('\n') + `\n\n${failed ? 'FAIL' : 'PASS'}`)
        return failed ? EXIT.failed : EXIT.ok
      }
      case 'hook': {
        const platform = args.positional[0]
        if (platform !== 'codex' && platform !== 'copilot' && platform !== 'gemini') throw new UsageError('usage: modspack hook <codex|copilot|gemini> (reads the tool call as JSON on stdin)')
        const result = runHook(platform, io.stdin ? await io.stdin() : '', dir)
        if (result.stdout !== '') io.out(result.stdout)
        if (result.stderr !== '') io.err(result.stderr)
        return result.code
      }
      default:
        io.err(`modspack: unknown command "${args.command}". Run modspack --help.`)
        return EXIT.usage
    }
  } catch (error) {
    if (error instanceof ConfigError || error instanceof UsageError) {
      io.err(`modspack: ${error.message}`)
      return EXIT.usage
    }
    throw error
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

// Run when executed, not when imported by the tests.
const invoked = process.argv[1] !== undefined && /modspack(\.mjs)?$/.test(process.argv[1])
if (invoked) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    error => {
      process.stderr.write(`modspack: unexpected error: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(EXIT.blocked)
    },
  )
}
