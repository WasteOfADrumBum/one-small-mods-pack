// Running other programs, the same way on every platform.
//
// On Windows `npm`, `pnpm`, `yarn` and `eslint` are `.cmd` shims: spawnSync
// without a shell fails with ENOENT, and since the 2024 Node security fix a
// `.cmd` file cannot be spawned without one at all. Where possible we run the
// tool's JavaScript entry with Node directly (no shell). Otherwise the shell is
// used, but only with arguments made of characters it does not interpret, so a
// script name from package.json cannot inject a command.
import { spawnSync } from 'node:child_process'
import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** Letters, digits and `_ @ : . / = + , -`: nothing cmd.exe or a POSIX shell treats specially. */
export const SHELL_SAFE = /^[A-Za-z0-9_@:./=+,-]+$/

export function npmCli(execPath = process.execPath, env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string | undefined {
  const fromNpm = env.npm_execpath
  if (fromNpm !== undefined && /npm-cli\.c?js$/.test(fromNpm) && exists(fromNpm)) return fromNpm
  const beside = path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return exists(beside) ? beside : undefined
}

function refused(reason: string): SpawnSyncReturns<string> {
  return { pid: 0, output: [], stdout: '', stderr: '', status: null, signal: null, error: new Error(reason) }
}

/** spawnSync that also works for Windows command shims. POSIX behaviour is plain spawnSync. */
export function spawnTool(command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding, platform: string = process.platform): SpawnSyncReturns<string> {
  if (platform !== 'win32') return spawnSync(command, args, options)
  if (command === 'npm') {
    const cli = npmCli()
    if (cli !== undefined) return spawnSync(process.execPath, [cli, ...args], options)
  }
  if (!SHELL_SAFE.test(command) || !args.every(a => SHELL_SAFE.test(a))) return refused(`not running ${command} through the Windows shell: an argument has characters the shell would interpret`)
  return spawnSync(command, args, { ...options, shell: true })
}
