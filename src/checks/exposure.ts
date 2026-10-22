// Supply-chain, CI and deployment exposure checks: deterministic, local, and
// limited to what the files show.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { readText } from '../core/files'
import type { Finding, Severity, Confidence } from '../core/report'
import { fingerprint } from './secrets'

function finding(rule: string, category: string, severity: Severity, confidence: Confidence, where: string, line: number | undefined, evidence: string, explanation: string, remediation: string, validation: string): Finding {
  const fp = fingerprint(rule, where, `${line ?? ''}:${evidence}`)
  return { id: `${category.toUpperCase().slice(0, 3)}-${rule}-${fp.slice(0, 8)}`, fingerprint: fp, category, rule, severity, confidence, path: where, line, evidence, explanation, remediation, validation, disposition: 'open' }
}

const UNTRUSTED_EXPR = /\$\{\{\s*github\.(event\.(issue|pull_request|comment|review|review_comment|discussion|head_commit|commits|pages)[^}]*\.(title|body|message|name|email|label|ref|head_ref|default_branch)|head_ref)\s*\}\}/

/** GitHub Actions workflow risks. */
export function workflowFindings(dir: string, files: readonly string[]): Finding[] {
  const out: Finding[] = []
  for (const file of files.filter(f => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))) {
    const read = readText(path.join(dir, file))
    if (!('text' in read)) continue
    const lines = read.text.split('\n')
    const text = read.text
    if (!/^permissions:/m.test(text)) {
      out.push(finding('workflow-no-permissions', 'ci', 'low', 'confirmed', file, undefined, 'no top-level permissions: block',
        'The GITHUB_TOKEN gets the repository default scope, which may be read-write.',
        'Add `permissions: contents: read` at the top and grant more per job only where needed.', 'No line starting with permissions: in the workflow.'))
    }
    lines.forEach((line, index) => {
      const n = index + 1
      if (/permissions:\s*write-all/.test(line)) {
        out.push(finding('workflow-write-all', 'ci', 'medium', 'confirmed', file, n, 'permissions: write-all', 'Every job gets a token that can write to the repository.', 'Grant only the scopes each job needs.', 'Literal match.'))
      }
      if (UNTRUSTED_EXPR.test(line)) {
        out.push(finding('workflow-script-injection', 'ci', 'high', 'likely', file, n, line.trim().slice(0, 120),
          'Text an outsider controls (an issue title, PR body, branch name) is expanded into the workflow. In a run: step it becomes shell code.',
          'Pass it through an environment variable (env: TITLE: ${{ github.event.issue.title }}) and quote "$TITLE" in the script.', 'Expression match; confirm it is inside a run: or script step.'))
      }
      const uses = /^\s*-?\s*uses:\s*([\w.-]+)\/([\w./-]+)@([\w.-]+)/.exec(line)
      if (uses !== null && !['actions', 'github'].includes(uses[1] ?? '') && !/^[0-9a-f]{40}$/.test(uses[3] ?? '')) {
        out.push(finding('workflow-unpinned-action', 'supply-chain', 'low', 'confirmed', file, n, `${uses[1]}/${uses[2]}@${uses[3]}`,
          'A third-party action is referenced by a movable tag; whoever controls the tag controls this step.', 'Pin it to a full commit SHA (with the tag in a comment).', 'The ref is not a 40-character SHA.'))
      }
      if (/(curl|wget)[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/.test(line)) {
        out.push(finding('remote-script-pipe', 'supply-chain', 'medium', 'confirmed', file, n, line.trim().slice(0, 120),
          'A script downloaded at run time is executed unverified.', 'Pin a version and verify a checksum, or use a maintained action.', 'Literal match.'))
      }
    })
    if (/pull_request_target/.test(text) && /actions\/checkout/.test(text) && /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.(sha|ref)/.test(text)) {
      out.push(finding('workflow-prt-checkout', 'ci', 'high', 'confirmed', file, undefined, 'pull_request_target + checkout of the PR head',
        'Code from a fork runs with the base repository secrets and a write token.', 'Use pull_request for untrusted code, or never run checked-out PR code in a pull_request_target job.', 'Both patterns are present in the workflow.'))
    }
  }
  return out
}

/** Dependencies that run install scripts, from package-lock.json (v2/v3). */
export function installScriptFindings(dir: string): { findings: Finding[]; checked: boolean } {
  const lockPath = path.join(dir, 'package-lock.json')
  const out: Finding[] = []
  const pkgPath = path.join(dir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
      for (const hook of ['preinstall', 'install', 'postinstall']) {
        const script = pkg.scripts?.[hook]
        if (script !== undefined && /(curl|wget|https?:\/\/)/.test(script)) {
          out.push(finding('install-script-network', 'supply-chain', 'medium', 'confirmed', 'package.json', undefined, `${hook}: ${script.slice(0, 80)}`,
            "The project's own install script fetches from the network on every install.", 'Vendor or pin what it downloads and verify a checksum.', 'scripts in package.json.'))
        }
      }
    } catch {
      // A broken package.json is the quality gate's problem.
    }
  }
  if (!existsSync(lockPath)) return { findings: out, checked: false }
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { packages?: Record<string, { hasInstallScript?: boolean; version?: string; dev?: boolean }> }
    const withScripts = Object.entries(lock.packages ?? {}).filter(([name, info]) => name !== '' && info.hasInstallScript)
    if (withScripts.length > 0) {
      const names = withScripts.map(([name, info]) => `${name.replace(/^.*node_modules\//, '')}@${info.version ?? '?'}`)
      out.push(finding('dependency-install-scripts', 'supply-chain', 'info', 'confirmed', 'package-lock.json', undefined, names.slice(0, 15).join(', ') + (names.length > 15 ? ` and ${names.length - 15} more` : ''),
        `${names.length} dependenc${names.length === 1 ? 'y runs' : 'ies run'} install scripts with your permissions on npm install.`,
        'Review them; consider npm ci --ignore-scripts in CI where the build allows it.', 'hasInstallScript in package-lock.json.'))
    }
    return { findings: out, checked: true }
  } catch {
    return { findings: out, checked: false }
  }
}

// Client-exposed environment variable prefixes, and names that are public by design.
const CLIENT_PREFIX = /\b(NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_|GATSBY_|PUBLIC_|STORYBOOK_)([A-Z0-9_]+)/g
const PUBLIC_BY_DESIGN = /(PUBLISHABLE|ANON_KEY|SITE_KEY|MEASUREMENT_ID|_DSN$|MAPS_API_KEY|FIREBASE_API_KEY|PUBLIC_KEY$|CLIENT_ID$|APP_ID$|PROJECT_ID$|POSTHOG_KEY$|ALGOLIA_SEARCH)/

/** Secret-looking variables a bundler would inline into the client. */
export function clientEnvFindings(dir: string, files: readonly string[]): Finding[] {
  const out: Finding[] = []
  const seen = new Set<string>()
  for (const file of files) {
    if (!/\.(m?[jt]sx?|vue|svelte|astro|json|ya?ml|toml)$|(^|\/)\.env[\w.-]*$/.test(file)) continue
    const read = readText(path.join(dir, file))
    if (!('text' in read)) continue
    read.text.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(CLIENT_PREFIX)) {
        const name = `${match[1]}${match[2]}`
        const rest = match[2] ?? ''
        if (PUBLIC_BY_DESIGN.test(rest) || seen.has(`${file}:${name}`)) continue
        const secretish = /(SECRET|PRIVATE|PASSWORD|PASSWD|SERVICE_ROLE|ADMIN_KEY|SIGNING|WEBHOOK)/.test(rest)
        const keyish = /(API_KEY|TOKEN|ACCESS_KEY|_KEY$)/.test(rest)
        if (!secretish && !keyish) continue
        seen.add(`${file}:${name}`)
        out.push(finding('client-env-secret', 'deployment', secretish ? 'high' : 'medium', 'likely', file, index + 1, name,
          `${match[1]} variables are inlined into the browser bundle, so ${name} is readable by anyone who loads the site.`,
          'Use it only on the server under a name without the public prefix; if it must reach the client, confirm the key is restricted (domain, scope) and public by design.',
          'Variable name match; the value was not read.'))
      }
    })
  }
  return out
}

/** Source maps, debug files and secrets files in build output or public/. */
export function publicArtifactFindings(dir: string, buildFiles: readonly string[]): Finding[] {
  const out: Finding[] = []
  const maps = buildFiles.filter(f => f.endsWith('.map') && !f.startsWith('.next/server/') && !f.startsWith('.next/cache/'))
  if (maps.length > 0) {
    out.push(finding('public-source-maps', 'deployment', 'medium', 'likely', maps[0] ?? '', undefined, `${maps.length} source map${maps.length === 1 ? '' : 's'} in build output (first: ${maps[0]})`,
      'Source maps in served output publish the original source, including comments and any embedded values.',
      'Turn them off for production builds, upload them privately to your error tracker, or confirm the source is meant to be public.', 'Files ending in .map under build output folders.'))
  }
  for (const file of buildFiles) {
    if (/(^|\/)\.env(\.[\w.-]+)?$|\.(sql|sqlite|db|bak|old|orig|swp|log|pem|key|p12|pfx)$|(^|\/)(id_rsa|id_ed25519|\.htpasswd|\.git\/config|phpinfo\.php)$/.test(file)) {
      out.push(finding('public-sensitive-file', 'deployment', 'high', 'likely', file, undefined, path.basename(file),
        'A file of a kind that usually holds secrets, data or debug output is in served output.', 'Remove it from public/ or the build, and check whether it was ever deployed.', 'File name match.'))
    }
  }
  for (const config of ['next.config.js', 'next.config.mjs', 'next.config.ts']) {
    const read = readText(path.join(dir, config))
    if ('text' in read && /productionBrowserSourceMaps\s*:\s*true/.test(read.text)) {
      out.push(finding('next-browser-source-maps', 'deployment', 'medium', 'confirmed', config, undefined, 'productionBrowserSourceMaps: true',
        'Production builds publish source maps of the client code.', 'Remove it unless the source is meant to be public.', 'Literal match.'))
    }
  }
  return out
}
