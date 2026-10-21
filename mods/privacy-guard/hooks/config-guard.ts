// Editing privacy-guard's own config is the one write that has to contain contact details: that is where
// publicContacts lives. The check normally judges a write against the config as it is on disk, so adding
// an address there is blocked (at blockAt low) before the list could ever hold it.
//
// This lets a write through only for values that are string entries of a top-level `publicContacts` array
// in a config that parses as JSON, on lines that hold nothing but that array. Everything else in the file is
// judged as usual: SSNs, cards, health data, an address in any other field, a malformed file.

const EMAIL = /^[^\s@",\\]+@[^\s@",\\]+\.[^\s@",\\]+$/
const PHONE = /^\+?[\d\s().-]{7,20}$/
const MAX_ENTRIES = 200
const MAX_LENGTH = 254

export type PublicContacts = {
  /** Entries that are strings shaped like an email address or a phone number. */
  entries: string[]
  /** First and last line (1-based) of the array, both ends included. */
  firstLine: number
  lastLine: number
}

/** Whether `path` names the privacy-guard config file `configFile`, with either path separator and any case. */
export function isConfigPath(path: string, configFile: string): boolean {
  const norm = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
  const file = norm(configFile)
  const target = norm(path)
  return file !== '' && (target === file || target.endsWith('/' + file))
}

/** The offsets of the top-level `publicContacts` array in JSON text; undefined if it is missing or appears twice. */
function arrayRange(text: string): { start: number; end: number } | undefined {
  let depth = 0
  let found: { start: number; end: number } | undefined
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      const token = text.slice(i + 1, j)
      i = j
      if (depth !== 1 || token !== 'publicContacts') continue
      const after = /^\s*:\s*\[/.exec(text.slice(i + 1))
      if (after === null) return undefined
      if (found !== undefined) return undefined
      const start = i + 1 + after[0].length - 1
      let level = 0
      let k = start
      for (; k < text.length; k++) {
        const c = text[k]!
        if (c === '"') {
          k++
          while (k < text.length && text[k] !== '"') k += text[k] === '\\' ? 2 : 1
        } else if (c === '[' || c === '{') level++
        else if (c === ']' || c === '}') {
          level--
          if (level === 0) break
        }
      }
      if (k >= text.length) return undefined
      found = { start, end: k }
      i = k
    } else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth--
  }
  return found
}

/**
 * The publicContacts of a config being written, or undefined when none of it may be trusted: the text is not
 * JSON, is not an object, has no such array, or shares a line with anything but the array itself.
 */
export function publicContactsOf(text: string): PublicContacts | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const list: unknown = (parsed as Record<string, unknown>).publicContacts
  if (!Array.isArray(list) || list.length > MAX_ENTRIES) return undefined

  const range = arrayRange(text)
  if (range === undefined) return undefined
  const lineStart = text.lastIndexOf('\n', range.start) + 1
  const nextBreak = text.indexOf('\n', range.end)
  const lineEnd = nextBreak === -1 ? text.length : nextBreak
  // The key opens the first line and the closing bracket ends the last, so no other field can share them.
  if (!/^\s*"publicContacts"\s*:\s*\[/.test(text.slice(lineStart, range.start + 1))) return undefined
  if (!/^\s*,?\s*\r?$/.test(text.slice(range.end + 1, lineEnd))) return undefined

  const entries = list.filter(
    (entry): entry is string => typeof entry === 'string' && entry.length <= MAX_LENGTH && entry === entry.trim() && (EMAIL.test(entry) || PHONE.test(entry)),
  )
  const lineOf = (offset: number) => text.slice(0, offset).split('\n').length
  return { entries, firstLine: lineOf(range.start), lastLine: lineOf(range.end) }
}
