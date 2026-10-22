// Shared by every guardrail mod (each plugin carries its own copy, since a
// plugin may only import its own files). Settings are layered:
//   1. the mod's built-in defaults,
//   2. the plugin's userConfig options (/config, or pluginConfigs in settings),
//   3. the project's JSON config file, when it exists.
// Reading the file needs `$`, which never crosses an import, so each
// register.ts reads it and hands the text to `parseConfigText`.
import type { PluginOptions } from 'claude-code'

export type RawConfig = Record<string, unknown>

const isRecord = (value: unknown): value is RawConfig =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Parses a config file's text: an object, or an error message to log. */
export function parseConfigText(path: string, text: string): RawConfig | string {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : `${path} is not a JSON object; using the defaults`
  } catch (error) {
    return `could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** The first defined value among the file's, the option's and the default. */
export function pick<T>(
  file: RawConfig,
  options: PluginOptions,
  key: string,
  fallback: T,
  read: (value: unknown) => T | undefined,
): T {
  return read(file[key]) ?? read(options[key]) ?? fallback
}

export const asBool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : undefined

export const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

export const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** A list from a JSON array, a `multiple` option, or a comma-separated string. */
export const asList = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string' && value.trim() !== '') {
    return value.split(',').map(item => item.trim()).filter(item => item !== '')
  }
  return undefined
}
