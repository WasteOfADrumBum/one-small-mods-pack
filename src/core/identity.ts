// Friendly names for the agents. The technical ID (the agent's `name` in its
// definition, its file name on every platform) never changes; a display name
// is metadata beside it. Defaults ship in mods/modspack-agents/identities.json
// and a project overrides them with `agentNames` in modspack.config.json.
// Display names appear in the CLI, the instruction block, the docs and the
// site. They are not written into the native agent files, because no platform
// has a verified separate display-name field and renaming the `name` there
// would break references.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { ConfigError } from './config'
import type { AgentDefinition } from './definitions'

export type Identity = { id: string; name: string; role: string; custom: boolean }

/** Letters, digits, spaces and hyphens: safe in Markdown, TOML, YAML and shell output. */
export const DISPLAY_NAME = /^[A-Za-z][A-Za-z0-9 -]{0,31}$/

export function loadDefaultIdentities(root: string): Record<string, { name: string; role: string }> {
  const file = path.join(root, 'identities.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, { name: string; role: string }>) : {}
}

/** One identity per agent, in the agents' order. Throws ConfigError for a bad override. */
export function resolveIdentities(agents: readonly AgentDefinition[], defaults: Record<string, { name: string; role: string }>, overrides: Record<string, string> = {}): Identity[] {
  const ids = new Set(agents.map(a => a.name))
  for (const [id, name] of Object.entries(overrides)) {
    if (!ids.has(id)) throw new ConfigError(`agentNames: "${id}" is not an agent ID. Use one of: ${[...ids].join(', ')}`)
    if (!DISPLAY_NAME.test(name)) throw new ConfigError(`agentNames.${id}: "${name}" is not a valid display name (start with a letter; letters, digits, spaces and hyphens; at most 32 characters)`)
  }
  const out = agents.map(a => {
    const base = defaults[a.name]
    const custom = overrides[a.name]
    return { id: a.name, name: custom ?? base?.name ?? a.name, role: base?.role ?? a.name, custom: custom !== undefined && custom !== base?.name }
  })
  const seen = new Map<string, string>()
  for (const i of out) {
    const key = i.name.toLowerCase()
    if (seen.has(key)) throw new ConfigError(`agent display names must be unique: "${i.name}" is used by both ${seen.get(key)} and ${i.id}`)
    seen.set(key, i.id)
    if (agents.some(a => a.name !== i.id && a.name.toLowerCase() === key)) throw new ConfigError(`agent display name "${i.name}" is another agent's technical ID`)
  }
  return out
}
