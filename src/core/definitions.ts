// The canonical agent and skill definitions, read from the modspack-agents
// plugin. That plugin is the single source of truth: Claude Code loads it as
// is, the CLI renders it for the other platforms, and the site is generated
// from it.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { splitFrontmatter } from './frontmatter'
import type { Frontmatter } from './frontmatter'

export type Section = { heading: string; text: string }

export type SkillDefinition = {
  kind: 'skill'
  name: string
  description: string
  license?: string
  compatibility?: string
  metadata: Record<string, string>
  body: string
  sections: Section[]
  /** Directory of the skill, absolute. */
  dir: string
  /** Files beside SKILL.md, relative to the skill directory. */
  resources: string[]
}

export type AgentDefinition = {
  kind: 'agent'
  name: string
  description: string
  /** Claude Code tool names, the canonical spelling adapters map from. */
  tools: string[]
  body: string
  sections: Section[]
  file: string
}

export type DefinitionProblem = { file: string; message: string }

export const SKILL_SECTIONS = ['When to use', 'Prerequisites', 'Inputs', 'Steps', 'Outputs', 'Verification', 'Safety', 'Limitations'] as const
export const AGENT_SECTIONS = ['Responsibilities', 'When to invoke', 'Permissions', 'Workflow', 'Output', 'Limitations'] as const

/** Tools an agent may list. Read-only roles may not list Write, Edit or NotebookEdit. */
export const KNOWN_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'] as const
export const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

const SKILL_NAME = /^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$/

export function sections(body: string): Section[] {
  const out: Section[] = []
  let current: Section | undefined
  for (const line of body.split('\n')) {
    const match = /^## (.+?)\s*$/.exec(line)
    if (match !== null) {
      current = { heading: match[1] ?? '', text: '' }
      out.push(current)
    } else if (current !== undefined) {
      current.text += line + '\n'
    }
  }
  for (const section of out) section.text = section.text.trim()
  return out
}

const str = (data: Frontmatter, key: string): string | undefined => {
  const value = data[key]
  return typeof value === 'string' ? value : undefined
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full, base))
    else out.push(path.relative(base, full))
  }
  return out.sort()
}

function requireSections(found: Section[], required: readonly string[], file: string, problems: DefinitionProblem[]) {
  for (const heading of required) {
    const section = found.find(s => s.heading === heading)
    if (section === undefined) problems.push({ file, message: `missing "## ${heading}" section` })
    else if (section.text === '') problems.push({ file, message: `"## ${heading}" section is empty` })
  }
}

export function loadSkills(root: string, problems: DefinitionProblem[] = []): SkillDefinition[] {
  const dir = path.join(root, 'skills')
  if (!existsSync(dir)) return []
  const skills: SkillDefinition[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const skillDir = path.join(dir, entry.name)
    const file = path.join(skillDir, 'SKILL.md')
    if (!existsSync(file)) {
      problems.push({ file: skillDir, message: 'skill directory has no SKILL.md' })
      continue
    }
    let parsed
    try {
      parsed = splitFrontmatter(readFileSync(file, 'utf8'))
    } catch (error) {
      problems.push({ file, message: (error as Error).message })
      continue
    }
    const { data, body } = parsed
    const name = str(data, 'name') ?? ''
    const description = str(data, 'description') ?? ''
    // Agent Skills specification: https://agentskills.io/specification
    if (!SKILL_NAME.test(name)) problems.push({ file, message: `name "${name}" must be 1-64 lowercase letters, digits and single hyphens` })
    if (name !== entry.name) problems.push({ file, message: `name "${name}" must match its directory "${entry.name}"` })
    if (description.length < 1 || description.length > 1024) problems.push({ file, message: 'description must be 1-1024 characters' })
    const compatibility = str(data, 'compatibility')
    if (compatibility !== undefined && (compatibility.length < 1 || compatibility.length > 500)) {
      problems.push({ file, message: 'compatibility must be 1-500 characters' })
    }
    const metadata = data.metadata
    if (metadata !== undefined && (typeof metadata !== 'object' || Array.isArray(metadata))) {
      problems.push({ file, message: 'metadata must be a map of string keys to string values' })
    }
    for (const key of Object.keys(data)) {
      if (!['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'].includes(key)) {
        problems.push({ file, message: `unknown frontmatter field "${key}" (not in the Agent Skills specification)` })
      }
    }
    if (body.split('\n').length > 500) problems.push({ file, message: 'SKILL.md body is over 500 lines; move detail into references/' })
    const found = sections(body)
    requireSections(found, SKILL_SECTIONS, file, problems)
    const resources = listFiles(skillDir).filter(f => f !== 'SKILL.md')
    for (const ref of body.matchAll(/\]\(((?:references|scripts|assets)\/[^)\s]+)\)/g)) {
      if (!resources.includes(ref[1] ?? '')) problems.push({ file, message: `links to ${ref[1]}, which does not exist` })
    }
    skills.push({
      kind: 'skill',
      name,
      description,
      license: str(data, 'license'),
      compatibility,
      metadata: metadata !== undefined && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
      body,
      sections: found,
      dir: skillDir,
      resources,
    })
  }
  return skills
}

export function loadAgents(root: string, problems: DefinitionProblem[] = []): AgentDefinition[] {
  const dir = path.join(root, 'agents')
  if (!existsSync(dir)) return []
  const agents: AgentDefinition[] = []
  for (const name of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const file = path.join(dir, name)
    let parsed
    try {
      parsed = splitFrontmatter(readFileSync(file, 'utf8'))
    } catch (error) {
      problems.push({ file, message: (error as Error).message })
      continue
    }
    const { data, body } = parsed
    const agentName = str(data, 'name') ?? ''
    if (!SKILL_NAME.test(agentName)) problems.push({ file, message: `name "${agentName}" must be lowercase letters, digits and hyphens` })
    if (`${agentName}.md` !== name) problems.push({ file, message: `name "${agentName}" must match the file name` })
    const description = str(data, 'description') ?? ''
    if (description.length < 1 || description.length > 1024) problems.push({ file, message: 'description must be 1-1024 characters' })
    const toolsRaw = data.tools
    const tools = typeof toolsRaw === 'string' ? toolsRaw.split(',').map(t => t.trim()).filter(Boolean) : Array.isArray(toolsRaw) ? toolsRaw : []
    if (tools.length === 0) problems.push({ file, message: 'tools must list at least one tool' })
    for (const tool of tools) {
      if (!(KNOWN_TOOLS as readonly string[]).includes(tool)) problems.push({ file, message: `unknown tool "${tool}"` })
    }
    for (const key of Object.keys(data)) {
      if (!['name', 'description', 'tools'].includes(key)) problems.push({ file, message: `unknown frontmatter field "${key}"` })
    }
    const found = sections(body)
    requireSections(found, AGENT_SECTIONS, file, problems)
    agents.push({ kind: 'agent', name: agentName, description, tools, body, sections: found, file })
  }
  return agents
}

export const sectionText = (def: { sections: Section[] }, heading: string) => def.sections.find(s => s.heading === heading)?.text ?? ''
