#!/usr/bin/env node
// Copies the Claude Code type declarations for the build you run into
// types/claude-code.d.ts (git-ignored), for `npm run typecheck`.
//
// Claude Code writes them beside a mod it loads from a folder it watches:
// start `claude --plugin-dir mods/qa-gate` once, then run this. Or pass the
// path of a claude-code.d.ts you already have:
//   node scripts/link-types.mjs /path/to/claude-code.d.ts
//
// The declarations are Anthropic's and are not redistributed in this repo.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { projectRoot } from './root.mjs'

const root = projectRoot(import.meta.url)
const target = path.join(root, 'types', 'claude-code.d.ts')

const candidates = process.argv[2]
  ? [path.resolve(process.argv[2])]
  : readdirSync(path.join(root, 'mods')).map(mod =>
      path.join(root, 'mods', mod, '.claude-plugin', 'types', 'claude-code', 'index.d.ts'),
    )

const source = candidates.find(existsSync)
if (source === undefined) {
  console.error(
    'No Claude Code type declarations found. Claude Code writes them in two cases:\n' +
      '  1. when it loads a mod: start `claude --plugin-dir mods/qa-gate` once (needs mods enabled in your account);\n' +
      '  2. when its bundled plugin-authoring skill loads: ask Claude Code to use that skill; the skill text names the\n' +
      '     claude-code.d.ts it just wrote.\n' +
      'Then pass that file: node scripts/link-types.mjs <path to claude-code.d.ts>',
  )
  process.exit(1)
}

mkdirSync(path.dirname(target), { recursive: true })
copyFileSync(source, target)
console.log(`${readFileSync(target, 'utf8').split('\n')[0]} -> types/claude-code.d.ts`)
