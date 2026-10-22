// A strict reader for the YAML frontmatter of SKILL.md and agent files. It
// takes the subset those files use (scalars, quoted strings, folded and
// literal blocks, one level of lists or string maps) and rejects anything
// else, so a definition never parses differently here than in a client.

export type FrontmatterValue = string | string[] | Record<string, string>
export type Frontmatter = Record<string, FrontmatterValue>

export class FrontmatterError extends Error {}

const KEY = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?$/

function scalar(raw: string, where: string): string {
  const text = raw.trim()
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new FrontmatterError(`${where}: unterminated double-quoted string`)
    return JSON.parse(text) as string
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new FrontmatterError(`${where}: unterminated single-quoted string`)
    return text.slice(1, -1).replace(/''/g, "'")
  }
  if (/^[[{&*!|>%@`]/.test(text)) throw new FrontmatterError(`${where}: unsupported YAML syntax "${text.slice(0, 20)}"`)
  // A plain scalar YAML would read differently: "a: b" is a map, " #" starts a comment.
  if (/:\s/.test(text) || /:$/.test(text)) throw new FrontmatterError(`${where}: quote this value, it contains ": "`)
  return text.replace(/\s+#.*$/, '')
}

/** Splits a Markdown file into its frontmatter and body. */
export function splitFrontmatter(text: string): { data: Frontmatter; body: string } {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) throw new FrontmatterError('file does not start with a --- frontmatter block')
  const end = normalized.indexOf('\n---', 4)
  if (end < 0) throw new FrontmatterError('frontmatter block is not closed with ---')
  const after = normalized.slice(end + 4)
  if (after !== '' && !after.startsWith('\n')) throw new FrontmatterError('frontmatter closing --- must be on its own line')
  return { data: parseFrontmatter(normalized.slice(4, end)), body: after.replace(/^\n/, '') }
}

export function parseFrontmatter(block: string): Frontmatter {
  const lines = block.split('\n')
  const data: Frontmatter = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const where = `frontmatter line ${i + 1}`
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      i += 1
      continue
    }
    if (/^\s/.test(line)) throw new FrontmatterError(`${where}: unexpected indentation`)
    const match = KEY.exec(line)
    if (match === null) throw new FrontmatterError(`${where}: expected "key: value"`)
    const key = match[1] ?? ''
    const rest = (match[2] ?? '').trim()
    if (Object.prototype.hasOwnProperty.call(data, key)) throw new FrontmatterError(`${where}: duplicate key "${key}"`)
    i += 1

    if (rest === '>' || rest === '|' || rest === '>-' || rest === '|-') {
      const block: string[] = []
      while (i < lines.length && (/^\s+\S/.test(lines[i] ?? '') || (lines[i] ?? '').trim() === '')) {
        block.push((lines[i] ?? '').trim())
        i += 1
      }
      data[key] = rest.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim()
      continue
    }
    if (rest !== '') {
      data[key] = scalar(rest, where)
      continue
    }

    // A nested list or map, indented under the key.
    const list: string[] = []
    const map: Record<string, string> = {}
    while (i < lines.length && (/^\s+\S/.test(lines[i] ?? '') || (lines[i] ?? '').trim() === '')) {
      const inner = (lines[i] ?? '').trim()
      const innerWhere = `frontmatter line ${i + 1}`
      i += 1
      if (inner === '' || inner.startsWith('#')) continue
      if (inner.startsWith('- ')) {
        list.push(scalar(inner.slice(2), innerWhere))
        continue
      }
      const pair = KEY.exec(inner)
      if (pair === null || pair[2] === undefined) throw new FrontmatterError(`${innerWhere}: expected "- item" or "key: value"`)
      map[pair[1] ?? ''] = scalar(pair[2], innerWhere)
    }
    if (list.length > 0 && Object.keys(map).length > 0) throw new FrontmatterError(`${where}: "${key}" mixes a list and a map`)
    data[key] = Object.keys(map).length > 0 ? map : list
  }
  return data
}

/** Writes a frontmatter value back as YAML, quoting whenever a plain scalar could be misread. */
export function yamlScalar(value: string): string {
  return /^[\w][\w .,/()+-]*$/.test(value) && !/:\s|\s#/.test(value) && !/^(true|false|null|yes|no|on|off|~|\d)/i.test(value)
    ? value
    : JSON.stringify(value)
}
