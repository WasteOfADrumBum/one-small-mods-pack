#!/usr/bin/env node
// Bundles the CLI (src/cli.ts) and the test entry (src/lib.ts) into dist/.
// The mods' pure modules are imported straight from mods/, so the CLI and the
// Claude Code mods run the same rules from one copy.
import { build } from 'esbuild'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

const common = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
}

await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/modspack.mjs', banner: { js: '#!/usr/bin/env node' } })
await build({ ...common, entryPoints: ['src/lib.ts'], outfile: 'dist/lib.mjs' })
console.log('built dist/modspack.mjs and dist/lib.mjs')
