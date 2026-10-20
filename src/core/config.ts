// modspack.config.json: read, validated against schema/modspack.schema.json,
// and filled in with defaults. A config that does not validate stops the
// command with exit code 2 rather than running with half the rules.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import schemaJson from '../../schema/modspack.schema.json'
import { validate } from './schema'
import type { Schema } from './schema'

export const CONFIG_FILE = 'modspack.config.json'

import type { Severity } from './report'
export type Platform = 'claude-code' | 'codex' | 'copilot' | 'gemini'
export const PLATFORMS: readonly Platform[] = ['claude-code', 'codex', 'copilot', 'gemini']
export type Gate = 'quality' | 'security' | 'privacy' | 'accessibility' | 'design' | 'package'

export type Accepted = { fingerprint: string; reason: string; kind?: 'false-positive' | 'accepted-risk'; approvedBy?: string }

export type ModspackConfig = {
  mode: 'enforce' | 'advisory'
  adapters?: Platform[]
  skills?: string[]
  agents?: string[]
  exclude: string[]
  guards: Record<'quality' | 'security' | 'privacy' | 'accessibility' | 'design', boolean>
  security: { failOn: Exclude<Severity, 'info'>; history: { enabled: boolean; maxCommits: number }; dependencyAudit: boolean; externalScanners: boolean; accepted: Accepted[] }
  privacy: { hipaa: 'auto' | 'on' | 'off'; publicContacts: string[]; allowDomains: string[] }
  design: { tokensFile?: string; allow: string[] }
  quality: { required: string[]; scripts: Record<string, string[]>; timeoutSeconds: number }
  accessibility: { required: boolean; paths?: string[] }
  release: { requiredGates: Gate[] }
  report: { dir: string }
}

export class ConfigError extends Error {}

export const schema = schemaJson as Schema

type Raw = Record<string, any>

export function resolveConfig(raw: Raw): ModspackConfig {
  const errors = validate(raw, schema)
  if (errors.length > 0) throw new ConfigError(`${CONFIG_FILE} is not valid:\n${errors.map(e => `  - ${e}`).join('\n')}`)
  return {
    mode: raw.mode ?? 'enforce',
    adapters: raw.adapters,
    skills: raw.skills,
    agents: raw.agents,
    exclude: raw.exclude ?? [],
    guards: { quality: true, security: true, privacy: true, accessibility: true, design: true, ...raw.guards },
    security: {
      failOn: raw.security?.failOn ?? 'high',
      history: { enabled: raw.security?.history?.enabled ?? true, maxCommits: raw.security?.history?.maxCommits ?? 200 },
      dependencyAudit: raw.security?.dependencyAudit ?? false,
      externalScanners: raw.security?.externalScanners ?? true,
      accepted: raw.security?.accepted ?? [],
    },
    privacy: { hipaa: raw.privacy?.hipaa ?? 'auto', publicContacts: raw.privacy?.publicContacts ?? [], allowDomains: raw.privacy?.allowDomains ?? [] },
    design: { tokensFile: raw.design?.tokensFile, allow: raw.design?.allow ?? ['0', '0px'] },
    quality: { required: raw.quality?.required ?? [], scripts: raw.quality?.scripts ?? {}, timeoutSeconds: raw.quality?.timeoutSeconds ?? 600 },
    accessibility: { required: raw.accessibility?.required ?? false, paths: raw.accessibility?.paths },
    release: { requiredGates: raw.release?.requiredGates ?? ['quality', 'security', 'privacy', 'accessibility', 'package'] },
    report: { dir: raw.report?.dir ?? '.modspack/reports' },
  }
}

/** The project's config, or the defaults when it has none. */
export function loadConfig(projectDir: string): { config: ModspackConfig; file?: string } {
  const file = path.join(projectDir, CONFIG_FILE)
  if (!existsSync(file)) return { config: resolveConfig({}) }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new ConfigError(`${CONFIG_FILE} is not valid JSON: ${(error as Error).message}`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ConfigError(`${CONFIG_FILE} must hold a JSON object`)
  return { config: resolveConfig(raw as Raw), file }
}
