// Which package.json scripts the gate runs, how, and how a failure is told.

export type Check = 'lint' | 'typecheck' | 'spellcheck' | 'test'

export const CHECKS: readonly Check[] = ['lint', 'typecheck', 'spellcheck', 'test']

/** The script names each check looks for, first match wins. */
export const DEFAULT_SCRIPTS: Record<Check, string[]> = {
  lint: ['lint'],
  typecheck: ['typecheck', 'type-check', 'check-types', 'types', 'tsc'],
  spellcheck: ['spellcheck', 'spell-check', 'spell', 'cspell'],
  test: ['test', 'test:unit'],
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export const LOCKFILES: readonly [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
]

// npm init's placeholder test script, which always fails.
const PLACEHOLDER_TEST = /no test specified/

/** The scripts to run, in order: the first defined name for each check, skipping missing ones. */
export function planScripts(
  scripts: Record<string, unknown>,
  names: Partial<Record<Check, readonly string[]>>,
  checks: readonly Check[] = CHECKS,
): { check: Check; script: string }[] {
  const plan: { check: Check; script: string }[] = []
  for (const check of checks) {
    const script = (names[check] ?? DEFAULT_SCRIPTS[check]).find(name => {
      const body = scripts[name]
      return typeof body === 'string' && body.trim() !== '' && !(check === 'test' && PLACEHOLDER_TEST.test(body))
    })
    if (script !== undefined) plan.push({ check, script })
  }
  return plan
}

/** The argv that runs a script under the package manager, with extra arguments passed through to it. */
export function scriptArgv(manager: PackageManager, script: string, extra: readonly string[] = []): string[] {
  switch (manager) {
    case 'yarn':
    case 'pnpm':
    case 'bun':
      return [manager, 'run', script, ...extra]
    default:
      return ['npm', 'run', '--silent', script, ...(extra.length > 0 ? ['--', ...extra] : [])]
  }
}

/**
 * The arguments that scope a check to the files Claude changed: the files
 * themselves for lint and spell check, `testArgs` then the files for tests
 * (only when `testArgs` is set, since runners spell it differently), and
 * none for the type check, which needs the whole project.
 */
export function scopeArgs(check: Check, files: readonly string[], testArgs: readonly string[] | undefined): string[] | undefined {
  if (files.length === 0) return undefined
  if (check === 'lint' || check === 'spellcheck') return [...files]
  if (check === 'test' && testArgs !== undefined) return [...testArgs, ...files]
  return undefined
}

/** The tail of a script's output: enough to act on, not the whole log. */
export function tail(output: string, maxLines = 60, maxChars = 4000): string {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, '').trimEnd().split('\n')
  let text = lines.slice(-maxLines).join('\n')
  if (text.length > maxChars) text = '…' + text.slice(-maxChars)
  return lines.length > maxLines ? `…(${lines.length - maxLines} earlier lines cut)\n${text}` : text
}

export type Failure = { check: Check; script: string; exitCode: number; output: string }

/** What Claude reads when the gate holds the turn. */
export function failureMessage(failures: readonly Failure[], command: (script: string) => string): string {
  return [
    `qa-gate: ${failures.length} check${failures.length === 1 ? '' : 's'} failed after your code changes. Fix the errors below, then finish:`,
    ...failures.map(f =>
      [`### ${f.check} (\`${command(f.script)}\` exited ${f.exitCode})`, '```', tail(f.output), '```'].join('\n'),
    ),
  ].join('\n\n')
}
