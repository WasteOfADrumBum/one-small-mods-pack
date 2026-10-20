#!/usr/bin/env node
// A plugin may only import its own files, so some modules are copied into
// each mod that needs them. This fails when the copies drift apart.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SHARED = ['hooks/config.ts', 'hooks/bash-writes.ts']

let failed = false
for (const rel of SHARED) {
  const copies = readdirSync(path.join(root, 'mods'))
    .map(mod => path.join('mods', mod, rel))
    .filter(file => existsSync(path.join(root, file)))
  const [first, ...rest] = copies
  if (first === undefined) continue
  const text = readFileSync(path.join(root, first), 'utf8')
  let drift = false
  for (const other of rest) {
    if (readFileSync(path.join(root, other), 'utf8') !== text) {
      console.error(`FAIL ${other} differs from ${first}; change every copy together`)
      drift = failed = true
    }
  }
  if (!drift) console.log(`PASS ${rel}: ${copies.length} identical copies`)
}
process.exit(failed ? 1 : 0)
