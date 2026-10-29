// A validator for the JSON Schema subset schema/modspack.schema.json uses:
// type, enum, properties, additionalProperties, required, items, minimum,
// maximum. Anything outside that subset in a schema is reported, so the
// schema can't silently stop being enforced.

export type Schema = {
  type?: string | string[]
  enum?: unknown[]
  properties?: Record<string, Schema>
  additionalProperties?: boolean | Schema
  required?: string[]
  items?: Schema
  minimum?: number
  maximum?: number
  description?: string
  title?: string
  $schema?: string
  $id?: string
}

const SUPPORTED = new Set(['type', 'enum', 'properties', 'additionalProperties', 'required', 'items', 'minimum', 'maximum', 'description', 'title', '$schema', '$id'])

const typeOf = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value

const matchesType = (value: unknown, type: string) => {
  const actual = typeOf(value)
  return actual === type || (type === 'number' && actual === 'integer')
}

/** Every schema keyword this validator would ignore. */
export function unsupportedKeywords(schema: Schema, at = '#'): string[] {
  const out: string[] = []
  for (const key of Object.keys(schema)) if (!SUPPORTED.has(key)) out.push(`${at}/${key}`)
  for (const [name, sub] of Object.entries(schema.properties ?? {})) out.push(...unsupportedKeywords(sub, `${at}/properties/${name}`))
  if (schema.items !== undefined) out.push(...unsupportedKeywords(schema.items, `${at}/items`))
  if (typeof schema.additionalProperties === 'object') out.push(...unsupportedKeywords(schema.additionalProperties, `${at}/additionalProperties`))
  return out
}

/** Problems with `value` against `schema`, each as "path: message". Empty means valid. */
export function validate(value: unknown, schema: Schema, at = '$'): string[] {
  const errors: string[] = []
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some(t => matchesType(value, t))) {
      return [`${at}: expected ${types.join(' or ')}, got ${typeOf(value)}`]
    }
  }
  if (schema.enum !== undefined && !schema.enum.some(option => option === value)) {
    errors.push(`${at}: must be one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}, got ${JSON.stringify(value)}`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: must be at least ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: must be at most ${schema.maximum}`)
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => errors.push(...validate(item, schema.items as Schema, `${at}[${index}]`)))
  }
  if (typeOf(value) === 'object') {
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!(key in record)) errors.push(`${at}: missing required key "${key}"`)
    }
    for (const [key, item] of Object.entries(record)) {
      const sub = schema.properties?.[key]
      if (sub !== undefined) errors.push(...validate(item, sub, `${at}.${key}`))
      else if (schema.additionalProperties === false) errors.push(`${at}: unknown key "${key}"`)
      else if (typeof schema.additionalProperties === 'object') errors.push(...validate(item, schema.additionalProperties, `${at}.${key}`))
    }
  }
  return errors
}
