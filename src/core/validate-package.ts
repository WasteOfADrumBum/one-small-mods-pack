// Validates the package's own canonical definitions and catalogs: what
// `modspack validate` and CI run.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { DISPLAY_NAME, loadDefaultIdentities, resolveIdentities } from './identity'
import { loadAgents, loadSkills, WRITE_TOOLS } from './definitions'
import type { DefinitionProblem } from './definitions'
import { schema } from './config'
import { unsupportedKeywords } from './schema'

export type Catalog = {
  guards: GuardEntry[]
  compatibility: Compatibility
}

export type GuardEntry = {
  name: string
  kind: 'claude-mod' | 'cli-check'
  checks: string
  runs: string
  effect: 'blocks' | 'advises' | 'blocks-or-advises' | 'redacts'
  failure: string
  missingDependency: string
  configure: string
  results: string
  troubleshooting: string
  cli: string
  platforms: Record<string, string>
}

export type CompatibilityCell = { status: 'supported' | 'partial' | 'cli-fallback' | 'unsupported'; verified: 'runtime' | 'harness' | 'static' | 'none'; note: string }
export type Compatibility = {
  checkedOn: string
  platforms: Record<string, { label: string; version: string; docs: string[] }>
  capabilities: Record<string, string>
  matrix: Record<string, Record<string, CompatibilityCell>>
}

export const READ_ONLY_AGENTS = new Set(['release-manager', 'code-reviewer', 'accessibility-auditor', 'security-privacy-auditor'])

export function readCatalog(root: string): Catalog {
  return {
    guards: JSON.parse(readFileSync(path.join(root, 'catalog', 'guards.json'), 'utf8')) as GuardEntry[],
    compatibility: JSON.parse(readFileSync(path.join(root, 'catalog', 'compatibility.json'), 'utf8')) as Compatibility,
  }
}

/** Every problem with the shipped definitions and catalogs; empty means valid. */
export function validatePackage(root: string): DefinitionProblem[] {
  const problems: DefinitionProblem[] = []
  const definitions = path.join(root, 'mods', 'modspack-agents')
  const skills = loadSkills(definitions, problems)
  const agents = loadAgents(definitions, problems)

  for (const agent of agents) {
    if (READ_ONLY_AGENTS.has(agent.name) && agent.tools.some(t => WRITE_TOOLS.has(t))) {
      problems.push({ file: agent.file, message: `${agent.name} is a read-only reviewer and may not list ${agent.tools.filter(t => WRITE_TOOLS.has(t)).join(', ')}` })
    }
    // Skills an agent names must exist.
    for (const ref of agent.body.matchAll(/`([a-z0-9-]+)` skill/g)) {
      if (!skills.some(s => s.name === ref[1])) problems.push({ file: agent.file, message: `refers to the ${ref[1]} skill, which does not exist` })
    }
  }

  // Every agent has exactly one default identity; names are unique and valid.
  const defaults = loadDefaultIdentities(definitions)
  const identityFile = path.join(definitions, 'identities.json')
  for (const agent of agents) if (defaults[agent.name] === undefined) problems.push({ file: identityFile, message: `${agent.name} has no default identity` })
  for (const id of Object.keys(defaults)) if (!agents.some(a => a.name === id)) problems.push({ file: identityFile, message: `${id} is not an agent` })
  try {
    resolveIdentities(agents, defaults)
    for (const [id, d] of Object.entries(defaults)) if (!DISPLAY_NAME.test(d.name) || d.role.trim() === '') problems.push({ file: identityFile, message: `${id} needs a valid display name and a role` })
  } catch (error) {
    problems.push({ file: identityFile, message: (error as Error).message })
  }

  for (const keyword of unsupportedKeywords(schema)) {
    problems.push({ file: 'schema/modspack.schema.json', message: `uses ${keyword}, which the validator does not enforce` })
  }

  let catalog: Catalog | undefined
  try {
    catalog = readCatalog(root)
  } catch (error) {
    problems.push({ file: 'catalog/', message: `could not read catalog: ${(error as Error).message}` })
  }
  if (catalog !== undefined) {
    const marketplace = JSON.parse(readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8')) as { plugins: { name: string; source: string }[] }
    const guardMods = marketplace.plugins.map(p => p.name).filter(n => n !== 'modspack-agents')
    for (const mod of guardMods) {
      if (!catalog.guards.some(g => g.name === mod)) problems.push({ file: 'catalog/guards.json', message: `mod ${mod} is in the marketplace but not documented` })
    }
    for (const guard of catalog.guards.filter(g => g.kind === 'claude-mod')) {
      if (!guardMods.includes(guard.name)) problems.push({ file: 'catalog/guards.json', message: `guard ${guard.name} is documented but is not in the marketplace` })
    }
    for (const plugin of marketplace.plugins) {
      if (!existsSync(path.join(root, plugin.source, '.claude-plugin', 'plugin.json'))) {
        problems.push({ file: '.claude-plugin/marketplace.json', message: `${plugin.name} points at ${plugin.source}, which has no plugin.json` })
      }
    }
    const { compatibility } = catalog
    const platforms = Object.keys(compatibility.platforms)
    for (const platform of ['claude-code', 'codex', 'copilot', 'gemini']) {
      if (!platforms.includes(platform)) problems.push({ file: 'catalog/compatibility.json', message: `platform ${platform} is missing` })
    }
    for (const capability of Object.keys(compatibility.capabilities)) {
      for (const platform of platforms) {
        const cell = compatibility.matrix[capability]?.[platform]
        if (cell === undefined) {
          problems.push({ file: 'catalog/compatibility.json', message: `${capability} has no entry for ${platform}` })
          continue
        }
        if (!['supported', 'partial', 'cli-fallback', 'unsupported'].includes(cell.status)) {
          problems.push({ file: 'catalog/compatibility.json', message: `${capability}/${platform} has unknown status ${cell.status}` })
        }
        // A capability is never called supported on static evidence alone.
        if (cell.status === 'supported' && cell.verified !== 'runtime' && cell.verified !== 'harness') {
          problems.push({ file: 'catalog/compatibility.json', message: `${capability}/${platform} is marked supported but only verified "${cell.verified}"` })
        }
      }
    }
  }

  // Every mod directory is listed in the marketplace.
  const marketplaceText = readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8')
  for (const dir of readdirSync(path.join(root, 'mods'))) {
    if (!marketplaceText.includes(`"./mods/${dir}"`)) problems.push({ file: `mods/${dir}`, message: 'is not listed in .claude-plugin/marketplace.json' })
  }
  return problems
}
