// modspack inspect: what the project is, and what AI configuration it already
// has, before anything is installed. Read-only. User-level folders are read
// only with --user; otherwise they are reported NOT INSPECTED.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { instructionFile } from '../adapters/render'
import { PLATFORMS } from '../core/config'
import type { Platform } from '../core/config'
import { parseFrontmatter } from '../core/frontmatter'
import { sourceFiles } from '../core/files'
import { readManifest } from '../install/install'

export type ConfigItem = { platform: Platform | 'shared'; kind: 'instructions' | 'agent' | 'skill' | 'hooks' | 'mcp' | 'settings'; path: string; name?: string; modspack: boolean }
export type Risk = { path: string; message: string }

export type Inspection = {
  project: {
    dir: string
    git: { isRepo: boolean; dirty: boolean | null; branch: string | null }
    node: { present: boolean; name?: string; private?: boolean; packageManager?: string; typescript: boolean; frameworks: string[]; scripts: string[]; hasInstalledModules: boolean }
    uiFiles: number
    designTokens: string | null
    ci: string[]
  }
  tools: Record<Platform, { onPath: boolean; configured: boolean }>
  config: ConfigItem[]
  duplicates: { name: string; kind: string; paths: string[] }[]
  risks: Risk[]
  modspack: { installed: boolean; platforms: string[]; version?: string; configFile: boolean }
  userLevel: 'NOT INSPECTED' | { path: string; items: string[] }[]
  recommendations: string[]
}

const onPath = (cmd: string) => {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

const git = (dir: string, args: string[]) => {
  try {
    return execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).toString().trim()
  } catch {
    return null
  }
}

const listDir = (abs: string) => (existsSync(abs) && statSync(abs).isDirectory() ? readdirSync(abs, { withFileTypes: true }) : [])

const TOKEN_FILES = ['design-tokens.json', 'tokens.json', 'src/styles/tokens.css', 'src/tokens.css', 'styles/tokens.css', 'src/design-tokens.json']

const MCP_FILES = ['.mcp.json', '.vscode/mcp.json', '.cursor/mcp.json']

const RISKY = [
  { re: /(curl|wget)[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, message: 'pipes a downloaded script into a shell' },
  { re: /dangerously-skip-permissions|--yolo|bypassPermissions|approval_policy\s*=\s*["']never["']/, message: 'turns off tool permission prompts' },
  { re: /"Bash\(\*\)"|"Bash\(\*:\*\)"|Bash\(\*\)/, message: 'allows every shell command without asking' },
  { re: /ignore (all )?(previous|prior|above) instructions|disregard (the )?(system|previous)/i, message: 'contains instruction-override wording (possible prompt injection)' },
  { re: /\bnpx\s+-y\s+[@\w]|"npx"\s*,\s*"args"\s*:\s*\[\s*"-y"/, message: 'runs an npx package that is downloaded on every start' },
]

export function inspect(dir: string, options: { user?: boolean } = {}): Inspection {
  const exists = (rel: string) => existsSync(path.join(dir, rel))
  const gitRoot = git(dir, ['rev-parse', '--is-inside-work-tree']) === 'true'
  const status = gitRoot ? git(dir, ['status', '--porcelain']) : null

  // Node / frontend
  let pkg: Record<string, any> | undefined
  if (exists('package.json')) {
    try {
      pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
    } catch {
      pkg = undefined
    }
  }
  const deps = Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies })
  const frameworks = ['next', 'react', 'vue', 'svelte', '@sveltejs/kit', 'astro', 'vite', 'nuxt', '@angular/core', 'express', 'fastify'].filter(d => deps.includes(d))
  const lock = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json'].find(exists)
  const files = sourceFiles(dir)
  const uiFiles = files.files.filter(f => /\.(html|css|scss|tsx|jsx|vue|svelte|astro)$/.test(f)).length

  // AI configuration
  const config: ConfigItem[] = []
  const add = (item: Omit<ConfigItem, 'modspack'>, content?: string) => config.push({ ...item, modspack: content?.includes('<!-- modspack:start -->') ?? false })
  const risks: Risk[] = []
  const scanRisk = (rel: string, text: string) => {
    for (const { re, message } of RISKY) if (re.test(text)) risks.push({ path: rel, message })
  }
  const readText = (rel: string) => {
    try {
      return readFileSync(path.join(dir, rel), 'utf8')
    } catch {
      return ''
    }
  }

  for (const platform of PLATFORMS) {
    const rel = instructionFile[platform]
    if (exists(rel) && !config.some(c => c.path === rel)) {
      const text = readText(rel)
      add({ platform: platform === 'codex' || platform === 'copilot' ? 'shared' : platform, kind: 'instructions', path: rel }, text)
      scanRisk(rel, text)
    }
  }
  for (const rel of ['.github/copilot-instructions.md']) if (exists(rel)) { add({ platform: 'copilot', kind: 'instructions', path: rel }, readText(rel)); scanRisk(rel, readText(rel)) }
  for (const entry of listDir(path.join(dir, '.github/instructions'))) if (entry.name.endsWith('.instructions.md')) add({ platform: 'copilot', kind: 'instructions', path: `.github/instructions/${entry.name}` })

  const agentDirs: [string, Platform, RegExp][] = [['.claude/agents', 'claude-code', /\.md$/], ['.codex/agents', 'codex', /\.toml$/], ['.github/agents', 'copilot', /\.agent\.md$/], ['.gemini/agents', 'gemini', /\.md$/]]
  for (const [rel, platform, re] of agentDirs) {
    for (const entry of listDir(path.join(dir, rel))) {
      if (entry.isFile() && re.test(entry.name)) {
        const text = readText(`${rel}/${entry.name}`)
        add({ platform, kind: 'agent', path: `${rel}/${entry.name}`, name: entry.name.replace(/\.(agent\.md|md|toml)$/, '') }, text)
        scanRisk(`${rel}/${entry.name}`, text)
      }
    }
  }
  const skillDirs: [string, Platform | 'shared'][] = [['.claude/skills', 'claude-code'], ['.agents/skills', 'shared'], ['.github/skills', 'copilot'], ['.gemini/skills', 'gemini']]
  for (const [rel, platform] of skillDirs) {
    for (const entry of listDir(path.join(dir, rel))) {
      const skillFile = `${rel}/${entry.name}/SKILL.md`
      if (entry.isDirectory() && exists(skillFile)) {
        let name = entry.name
        try {
          const front = readText(skillFile).split('\n---')[0] ?? ''
          const parsed = parseFrontmatter(front.replace(/^---\n/, ''))
          if (typeof parsed.name === 'string') name = parsed.name
        } catch {
          // an unreadable frontmatter keeps the directory name
        }
        add({ platform, kind: 'skill', path: skillFile, name })
        scanRisk(skillFile, readText(skillFile))
      }
    }
  }
  for (const rel of ['.claude/settings.json', '.claude/settings.local.json', '.codex/config.toml', '.gemini/settings.json']) {
    if (exists(rel)) { add({ platform: rel.startsWith('.claude') ? 'claude-code' : rel.startsWith('.codex') ? 'codex' : 'gemini', kind: 'settings', path: rel }); scanRisk(rel, readText(rel)) }
  }
  for (const rel of ['.codex/hooks.json']) if (exists(rel)) { add({ platform: 'codex', kind: 'hooks', path: rel }, readText(rel)); scanRisk(rel, readText(rel)) }
  for (const entry of listDir(path.join(dir, '.github/hooks'))) if (entry.name.endsWith('.json')) { add({ platform: 'copilot', kind: 'hooks', path: `.github/hooks/${entry.name}` }); scanRisk(`.github/hooks/${entry.name}`, readText(`.github/hooks/${entry.name}`)) }
  for (const rel of MCP_FILES) {
    if (!exists(rel)) continue
    add({ platform: 'shared', kind: 'mcp', path: rel })
    const text = readText(rel)
    scanRisk(rel, text)
    // Tokens in an MCP env block are named, never shown.
    if (/"(env|headers)"\s*:\s*\{[^}]*"[^"]*(token|key|secret|authorization)[^"]*"\s*:\s*"(?!\$\{)[^"]{8,}"/i.test(text)) risks.push({ path: rel, message: 'has a literal credential in an env or headers block (value not shown); use an environment variable reference' })
  }

  // Duplicates: the same agent or skill name where one client reads both places.
  const byName = new Map<string, { name: string; kind: string; paths: string[] }>()
  for (const item of config.filter(c => (c.kind === 'agent' || c.kind === 'skill') && c.name)) {
    const key = `${item.kind}:${item.name}`
    const entry = byName.get(key) ?? { name: item.name!, kind: item.kind, paths: [] }
    entry.paths.push(item.path)
    byName.set(key, entry)
  }
  // Copilot reads .github/skills, .claude/skills and .agents/skills; other agents live in separate native folders.
  const duplicates = [...byName.values()].filter(d => d.paths.length > 1 && (d.kind === 'skill' || new Set(d.paths.map(p => p.split('/')[0])).size < d.paths.length))

  const manifest = readManifest(dir)
  const tools = Object.fromEntries(
    PLATFORMS.map(platform => {
      const cli = { 'claude-code': 'claude', codex: 'codex', copilot: 'copilot', gemini: 'gemini' }[platform]
      return [platform, { onPath: onPath(cli), configured: config.some(c => c.platform === platform) }]
    }),
  ) as Inspection['tools']

  const userLevel: Inspection['userLevel'] = options.user
    ? ['.claude', '.codex', '.gemini', '.copilot', '.agents'].map(folder => {
        const abs = path.join(os.homedir(), folder)
        return { path: `~/${folder}`, items: listDir(abs).map(e => e.name).filter(n => !/token|credential|auth|key|secret/i.test(n)) }
      })
    : 'NOT INSPECTED'

  const recommendations: string[] = []
  const detected = PLATFORMS.filter(p => tools[p].configured)
  if (!manifest) recommendations.push(`Install with: modspack init --platform ${(detected.length > 0 ? detected : PLATFORMS).join(',')} (preview first; add --yes to apply).`)
  if (duplicates.length > 0) recommendations.push('Resolve the duplicate agents or skills below before installing, so a client does not see two definitions of one name.')
  if (uiFiles > 0 && !TOKEN_FILES.some(exists)) recommendations.push('UI files but no design tokens file: design-guardrail will stay idle until you add one (that is fine if the project has no design system).')
  if (!pkg) recommendations.push('No package.json: release-check will skip the quality and package gates as not applicable.')
  if (pkg && !files.files.some(f => /(^|\/)(test|tests|__tests__)\//.test(f) || /\.(test|spec)\./.test(f))) recommendations.push('No test files found: set quality.required to include "test" so a missing test script is BLOCKED, not skipped.')

  return {
    project: {
      dir,
      git: { isRepo: gitRoot, dirty: status === null ? null : status !== '', branch: gitRoot ? git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) : null },
      node: {
        present: pkg !== undefined,
        name: pkg?.name,
        private: pkg?.private,
        packageManager: lock === undefined ? undefined : { 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'bun.lock': 'bun', 'bun.lockb': 'bun', 'package-lock.json': 'npm' }[lock],
        typescript: deps.includes('typescript') || exists('tsconfig.json'),
        frameworks,
        scripts: Object.keys(pkg?.scripts ?? {}),
        hasInstalledModules: exists('node_modules'),
      },
      uiFiles,
      designTokens: TOKEN_FILES.find(exists) ?? null,
      ci: listDir(path.join(dir, '.github/workflows')).filter(e => /\.ya?ml$/.test(e.name)).map(e => e.name),
    },
    tools,
    config,
    duplicates,
    risks,
    modspack: { installed: manifest !== undefined, platforms: manifest?.platforms ?? [], version: manifest?.installedWith, configFile: exists('modspack.config.json') },
    userLevel,
    recommendations,
  }
}

export function renderInspection(i: Inspection): string {
  const L: string[] = []
  const n = i.project.node
  L.push(`Project: ${i.project.dir}`)
  L.push(`  git: ${i.project.git.isRepo ? `branch ${i.project.git.branch}, ${i.project.git.dirty ? 'uncommitted changes' : 'clean'}` : 'not a git repository'}`)
  L.push(`  node: ${n.present ? `${n.name ?? '(unnamed)'}${n.packageManager ? `, ${n.packageManager}` : ''}${n.typescript ? ', TypeScript' : ''}${n.frameworks.length ? `, ${n.frameworks.join('/')}` : ''}; scripts: ${n.scripts.join(', ') || 'none'}${n.hasInstalledModules ? '' : '; dependencies not installed'}` : 'no package.json'}`)
  L.push(`  UI files: ${i.project.uiFiles}; design tokens: ${i.project.designTokens ?? 'none'}; CI workflows: ${i.project.ci.join(', ') || 'none'}`)
  L.push('', 'AI tools (on PATH / configured in this project):')
  for (const p of PLATFORMS) L.push(`  ${p}: ${i.tools[p].onPath ? 'installed' : 'not on PATH'} / ${i.tools[p].configured ? 'has project config' : 'no project config'}`)
  L.push('', 'Existing AI configuration:')
  if (i.config.length === 0) L.push('  none found')
  for (const c of i.config) L.push(`  [${c.platform}] ${c.kind}: ${c.path}${c.name ? ` (${c.name})` : ''}${c.modspack ? ' (ModsPack)' : ''}`)
  if (i.duplicates.length > 0) { L.push('', 'Duplicates:'); for (const d of i.duplicates) L.push(`  ${d.kind} "${d.name}" in ${d.paths.join(' and ')}`) }
  if (i.risks.length > 0) { L.push('', 'Risks to review:'); for (const r of i.risks) L.push(`  ${r.path}: ${r.message}`) }
  L.push('', `ModsPack: ${i.modspack.installed ? `installed (${i.modspack.platforms.join(', ')}), version ${i.modspack.version}` : 'not installed'}; modspack.config.json: ${i.modspack.configFile ? 'present' : 'none'}`)
  L.push(`User-level configuration: ${i.userLevel === 'NOT INSPECTED' ? 'NOT INSPECTED (pass --user to list ~/.claude, ~/.codex, ~/.gemini, ~/.copilot, ~/.agents)' : i.userLevel.map(u => `${u.path}: ${u.items.length} entries`).join('; ')}`)
  if (i.recommendations.length > 0) { L.push('', 'Recommendations:'); for (const r of i.recommendations) L.push(`  - ${r}`) }
  return L.join('\n')
}
