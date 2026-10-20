// modspack: install the ModsPack agents, skills and guards into a project,
// and run its deterministic checks. Exit codes: 0 ok, 1 a gate failed,
// 2 usage or config error, 3 a required check could not run.
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { privacyGate, securityGate } from './checks/gates'
import { ConfigError, loadConfig } from './core/config'
import type { ModspackConfig } from './core/config'
import { PACKAGE_ROOT } from './core/paths'
import { renderMarkdown, renderText, writeReports } from './core/render'
import { EXIT, exitCode } from './core/report'
import type { GateResult } from './core/report'
import { validatePackage } from './core/validate-package'

export type Io = { out: (text: string) => void; err: (text: string) => void; cwd: string }

const VERSION = (JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version: string }).version

const HELP = `modspack ${VERSION}: AI development agents, skills and guards for Claude Code, Codex, Copilot and Gemini CLI

Usage: modspack <command> [options]

Commands:
  security        scan for committed secrets, CI and supply-chain risks, client exposure
  privacy         scan for personal and health data; HIPAA-related review when it applies
  validate        validate the shipped agent and skill definitions and catalogs

Options:
  --dir <path>    project directory (default: the current directory)
  --json          print JSON instead of text
  --write         also write Markdown and JSON reports to report.dir (.modspack/reports)
  --advisory      report only: exit 0 even when a gate fails (a check that could not run still exits 3)
  --verbose       list every finding, informational ones included
  --history       (privacy) also scan git history for personal data
  --no-history    (security) skip the git history scan
  --audit-deps    (security) run npm audit; sends the dependency list to the registry
  -h, --help      show this help
  -v, --version   print the version

Exit codes: 0 ok, 1 a gate failed, 2 usage or config error, 3 a required check could not run.`

/** Prints gates, writes reports when asked, and returns the exit code for the mode. */
function finish(io: Io, args: Args, dir: string, config: ModspackConfig, name: string, title: string, gates: GateResult[], json: Record<string, unknown> = {}, extra: string[] = []): number {
  const mode = args.flags.advisory ? 'advisory' : config.mode
  const code = exitCode(gates, mode)
  const payload = { tool: 'modspack', command: name, mode, exitCode: code, gates, ...json }
  if (args.flags.json) io.out(JSON.stringify(payload, null, 2))
  else io.out(renderText(gates, { verbose: Boolean(args.flags.verbose) }) + (extra.length > 0 ? '\n\n' + extra.join('\n') : ''))
  if (args.flags.write) {
    const written = writeReports(dir, config.report.dir, name, renderMarkdown(title, gates, extra), payload)
    if (!args.flags.json) io.out(`\nreports: ${written.map(f => path.relative(dir, f)).join(', ')}`)
  }
  return code
}

function projectDir(io: Io, args: Args): string {
  return path.resolve(io.cwd, typeof args.flags.dir === 'string' ? args.flags.dir : '.')
}

export type Args = { command: string | undefined; flags: Record<string, string | boolean>; lists: Record<string, string[]>; positional: string[] }

const LIST_FLAGS = new Set(['platform', 'skill', 'agent'])
const VALUE_FLAGS = new Set(['dir', 'platform', 'skill', 'agent', 'format', 'event'])

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
      } else {
        flags[name] = inline ?? true
      }
    } else positional.push(arg)
  }
  return { command: positional.shift(), flags, lists, positional }
}

const policyNote = (config: ModspackConfig) => [
  `Policy: open findings at ${config.security.failOn} or above fail the gate when confirmed, and need review when likely. Dismiss one by adding its fingerprint to security.accepted in modspack.config.json with a reason.`,
]

export class UsageError extends Error {}

export async function main(argv: readonly string[], io: Io = { out: t => process.stdout.write(t + '\n'), err: t => process.stderr.write(t + '\n'), cwd: process.cwd() }): Promise<number> {
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
    switch (args.command) {
      case 'validate': {
        const problems = validatePackage(PACKAGE_ROOT)
        if (args.flags.json) io.out(JSON.stringify({ status: problems.length === 0 ? 'PASS' : 'FAIL', problems }, null, 2))
        else if (problems.length === 0) io.out('PASS definitions, schema and catalogs are valid')
        else io.out(['FAIL', ...problems.map(p => `  ${path.relative(PACKAGE_ROOT, p.file) || p.file}: ${p.message}`)].join('\n'))
        return problems.length === 0 ? EXIT.ok : EXIT.failed
      }
      case 'security': {
        const dir = projectDir(io, args)
        const { config } = loadConfig(dir)
        const gate = securityGate(dir, config, { history: args.flags['no-history'] ? false : undefined, auditDeps: args.flags['audit-deps'] === true ? true : undefined })
        const { findings, ...result } = gate
        return finish(io, args, dir, config, 'security', 'Security report', [result], {}, policyNote(config))
      }
      case 'privacy': {
        const dir = projectDir(io, args)
        const { config } = loadConfig(dir)
        const gate = privacyGate(dir, config, { history: Boolean(args.flags.history) })
        const { findings, hipaa, ...result } = gate
        const extra = hipaa.active ? ['HIPAA-related review', hipaa.disclaimer, ...hipaa.items.map(i => `- ${i.status}: ${i.area}. ${i.note}`)] : [`HIPAA-related review not active: ${hipaa.reason}.`]
        return finish(io, args, dir, config, 'privacy', 'Privacy report', [result], { hipaa }, extra)
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
