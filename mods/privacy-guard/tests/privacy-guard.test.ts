import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { findPrivacy, isFixturePath, maskValue, newHits } from '../hooks/privacy'

// Every value here is synthetic. Real-looking ones are assembled from parts so
// a scanner reading this file sees no complete value on one line.
const SSN = '512' + '-38-' + '4021'
const CARD = '4556' + '7375' + '8689' + '9855'
const IBAN = 'FR14' + '2004' + '1010' + '0505' + '0001' + '3M02' + '606'

const kinds = (text: string, path = 'src/a.ts') => findPrivacy(text, { isFixture: isFixturePath(path) }).map(h => `${h.kind}:${h.severity}`)

describe('findPrivacy', () => {
  test('flags a labelled SSN as high and a bare one as medium', () => {
    expect(kinds(`const ssn = "${SSN}"`)).toEqual(['us-ssn:high'])
    expect(kinds(`const id = "${SSN}"`)).toEqual(['us-ssn:medium'])
  })

  test('treats known example and invalid SSNs as synthetic', () => {
    expect(findPrivacy('ssn: 123-45-6789')[0]).toMatchObject({ synthetic: true, severity: 'info' })
    expect(findPrivacy('ssn: 666-12-3456')[0]?.synthetic).toBe(true)
    expect(findPrivacy('version 123-45-6789')).toEqual([])
  })

  test('flags Luhn-valid card numbers and passes published test cards', () => {
    expect(kinds(`card: "${CARD}"`)).toEqual(['payment-card:high'])
    expect(findPrivacy('card: 4242 4242 4242 4242')[0]).toMatchObject({ synthetic: true, severity: 'info' })
    expect(findPrivacy('order 1234567812345678')).toEqual([])
  })

  test('checks IBAN checksums', () => {
    expect(kinds(`iban: ${IBAN}`)).toEqual(['iban:high'])
    expect(kinds('iban: FR1420041010050500013M02607')).toEqual([])
  })

  test('is context-aware about email addresses', () => {
    expect(kinds('author: jane@example.com')).toEqual([])
    expect(kinds('contact support@acme.io')).toEqual(['email:info'])
    expect(kinds('reviewer: jane.doe@acme.io')).toEqual(['email:low'])
    expect(kinds('{ "email": "jane.doe@acme.io", "diagnosis": "E11.9" }')).toEqual(['email:medium'])
    expect(findPrivacy('jane.doe@acme.io', { publicContacts: ['jane.doe@acme.io'] })).toEqual([])
    expect(findPrivacy('jane.doe@acme.io', { allowDomains: ['acme.io'] })).toEqual([])
  })

  test('finds health information tied to a person', () => {
    const record = ['{', '  "name": "Maria Lopez",', '  "diagnosis": "E11.9 type 2 diabetes",', '  "mrn": "MRN-0042-7781"', '}'].join('\n')
    expect(kinds(record)).toEqual(['phi-record:high', 'medical-record-number:high'])
    expect(kinds('// patient portal: shows the diagnosis list')).toEqual([])
  })

  test('steps real-looking values in test data down a level, for review', () => {
    expect(kinds(`ssn: "${SSN}"`, 'tests/fixtures/users.json')).toEqual(['us-ssn:medium'])
    expect(findPrivacy(`ssn: "${SSN}"`, { isFixture: true })[0]?.confidence).toBe('possible')
  })

  test('skips lines marked privacy-ignore, and never puts the value in the mask', () => {
    expect(findPrivacy(`ssn: "${SSN}" // privacy-ignore`)).toEqual([])
    const hit = findPrivacy(`ssn: "${SSN}"`)[0]!
    expect(maskValue(hit)).toBe('[us-ssn, 11 chars]')
    expect(maskValue(hit)).not.toContain('4021')
  })

  test('judges an edit on what it adds', () => {
    const before = findPrivacy(`ssn: "${SSN}"`)
    const after = findPrivacy(`ssn: "${SSN}"\ncard: "${CARD}"`)
    expect(newHits(after, before).map(h => h.kind)).toEqual(['payment-card'])
  })
})

function stubEngine(on: On, files: Record<string, string> = {}) {
  const status: (string | undefined)[] = []
  // Paths compare with "/" whatever separator the engine hands over: on Windows it hands backslashes.
  const slash = (p: string) => p.replace(/\\/g, '/')
  const find = (path: string) => Object.entries(files).find(([end]) => slash(path).endsWith(slash(end)))?.[1]
  on('fs.exists', ($, e) => ({ value: find(e.path) !== undefined }))
  on('fs.read', ($, e) => ({ value: find(e.path) ?? '' }))
  on('ui.status', ($, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'written' }))
  return { status }
}

test('blocks a Write that adds a real-looking SSN, without echoing it', async ($, on) => {
  const { status } = stubEngine(on)

  const out = await $.tool.call({ tool: 'Write', file_path: '/work/src/users.ts', content: `export const ssn = "${SSN}"` })

  expect(out.deny).toContain('privacy-guard: this Write to /work/src/users.ts writes data that looks like real personal or health information')
  expect(out.deny).toContain('line 1: PII us-ssn [us-ssn, 11 chars], high')
  expect(out.deny).not.toContain(SSN)
  expect(status.at(-1)).toContain('blocked 1')
})

test('lets synthetic values through untouched', async ($, on) => {
  const { status } = stubEngine(on)

  const out = await $.tool.call({ tool: 'Write', file_path: '/work/src/demo.ts', content: 'const card = "4242424242424242"\nconst email = "pat@example.com"' })

  expect(out.deny).toBeUndefined()
  expect(out.context ?? []).toEqual([])
  expect(status).toEqual([])
})

test('adds a note for medium values and lets the write go ahead', async ($, on) => {
  stubEngine(on)

  const out = await $.tool.call({ tool: 'Write', file_path: '/work/src/a.ts', content: `const id = "${SSN}"` })

  expect(out.deny).toBeUndefined()
  expect(out.context?.join('\n')).toContain('may be personal data')
})

test('judges an Edit only on the values it adds', async ($, on) => {
  stubEngine(on, { 'src/users.ts': `const ssn = "${SSN}"\n` })

  const out = await $.tool.call({ tool: 'Edit', file_path: '/work/src/users.ts', old_string: `const ssn = "${SSN}"`, new_string: `const ssn = "${SSN}" // reviewed` })

  expect(out.deny).toBeUndefined()
})

test('only warns in warn mode, and stands aside when turned off', async ($, on) => {
  stubEngine(on, { 'privacy-guard.json': JSON.stringify({ mode: 'warn' }) })
  const warned = await $.tool.call({ tool: 'Write', file_path: '/work/src/a.ts', content: `ssn: "${SSN}"` })
  expect(warned.deny).toBeUndefined()
  expect(warned.context?.join('\n')).toContain('us-ssn')
})

test('does nothing when the project config turns it off', async ($, on) => {
  stubEngine(on, { 'privacy-guard.json': JSON.stringify({ enabled: false }) })
  const out = await $.tool.call({ tool: 'Write', file_path: '/work/src/a.ts', content: `ssn: "${SSN}"` })
  expect(out.deny).toBeUndefined()
  expect(out.context ?? []).toEqual([])
})

test('skips ignored paths', async ($, on) => {
  stubEngine(on, { 'privacy-guard.json': JSON.stringify({ ignore: ['docs/**'] }) })
  const out = await $.tool.call({ tool: 'Write', file_path: 'docs/policy.md', content: `ssn: "${SSN}"` })
  expect(out.deny).toBeUndefined()
})

// Tool arguments come from the model as JSON, so they can be any type. The call is built from text to
// stay as untyped as it is on the wire.
const wire = (tool: string, args: Record<string, unknown>) => JSON.stringify({ tool, ...args })

describe('malformed tool arguments', () => {
  test('passes a Write or Edit with a missing or non-string path through, unscanned', async ($, on) => {
    stubEngine(on)
    for (const file_path of [undefined, 42, null, ['a.ts'], { path: 'a.ts' }]) {
      const write = await $.tool.call(JSON.parse(wire('Write', { file_path, content: `ssn: "${SSN}"` })))
      expect(write.deny).toBeUndefined()
      const edit = await $.tool.call(JSON.parse(wire('Edit', { file_path, old_string: 'a', new_string: `ssn: "${SSN}"` })))
      expect(edit.deny).toBeUndefined()
    }
  })

  test('treats non-string content and edit text as empty, without throwing', async ($, on) => {
    stubEngine(on)
    const write = await $.tool.call(JSON.parse(wire('Write', { file_path: '/work/src/a.ts', content: 42 })))
    expect(write.deny).toBeUndefined()
    const edit = await $.tool.call(JSON.parse(wire('Edit', { file_path: '/work/src/a.ts', old_string: { a: 1 }, new_string: ['x'] })))
    expect(edit.deny).toBeUndefined()
  })

  test('still blocks the same call once its fields are real strings', async ($, on) => {
    stubEngine(on)
    const out = await $.tool.call(JSON.parse(wire('Write', { file_path: '/work/src/a.ts', content: `export const ssn = "${SSN}"` })))
    expect(out.deny).toContain('privacy-guard')
  })
})

// ---- editing the guard's own config -------------------------------------------------------------------
const CONFIG = '/work/.claude/guardrail-mods/privacy-guard.json'
const PERSON = 'jane.doe@acme.io'
const pretty = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
const strict = { options: { blockAt: 'low' } } as const

describe('privacy-guard.json: publicContacts', () => {
  test('lets a Write add an address to publicContacts at blockAt low', strict, async ($, on) => {
    stubEngine(on, { 'privacy-guard.json': pretty({ blockAt: 'low' }) })

    const out = await $.tool.call({ tool: 'Write', file_path: CONFIG, content: pretty({ blockAt: 'low', publicContacts: [PERSON] }) })

    expect(out.deny).toBeUndefined()
  })

  test('the same address is still blocked in ordinary code at blockAt low', strict, async ($, on) => {
    stubEngine(on, {})

    const out = await $.tool.call({ tool: 'Write', file_path: '/work/src/a.ts', content: `const owner = "${PERSON}"` })

    expect(out.deny).toContain('privacy-guard')
  })

  test('lets an Edit add an address to the list, judging the whole file', strict, async ($, on) => {
    const before = pretty({ blockAt: 'low', publicContacts: ['help@acme.io'] })
    stubEngine(on, { 'privacy-guard.json': before })

    const out = await $.tool.call({ tool: 'Edit', file_path: CONFIG, old_string: '"help@acme.io"', new_string: `"help@acme.io",\n    "${PERSON}"` })

    expect(out.deny).toBeUndefined()
  })

  test('accepts a Windows path to the config', strict, async ($, on) => {
    stubEngine(on, {})
    const win = await $.tool.call({ tool: 'Write', file_path: 'C:\\work\\.claude\\guardrail-mods\\privacy-guard.json', content: pretty({ blockAt: 'low', publicContacts: [PERSON] }) })
    expect(win.deny).toBeUndefined()
  })

  test('accepts a public phone number listed there', strict, async ($, on) => {
    stubEngine(on, {})

    const out = await $.tool.call({ tool: 'Write', file_path: CONFIG, content: pretty({ blockAt: 'low', publicContacts: ['+1 (415) 555-0132'] }) })

    expect(out.deny).toBeUndefined()
  })

  test('does not exempt the same address in any other field of the file', strict, async ($, on) => {
    stubEngine(on, {})

    const out = await $.tool.call({ tool: 'Write', file_path: CONFIG, content: pretty({ blockAt: 'low', publicContacts: [PERSON], owner: PERSON }) })

    expect(out.deny).toContain('privacy-guard')
    expect(out.deny).not.toContain(PERSON)
  })

  test('still blocks an SSN, a card or health data in the config, with or without a valid list', strict, async ($, on) => {
    stubEngine(on, {})
    const write = (config: unknown) => $.tool.call({ tool: 'Write', file_path: CONFIG, content: pretty(config) })

    expect((await write({ publicContacts: [PERSON], note: `ssn: ${SSN}` })).deny).toContain('us-ssn')
    expect((await write({ publicContacts: [PERSON], note: `card: ${CARD}` })).deny).toContain('payment-card')
    expect((await write({ publicContacts: [PERSON], name: 'Maria Lopez', diagnosis: 'E11.9 type 2 diabetes', mrn: 'MRN-0042-7781' })).deny).toContain('privacy-guard')
    // a number listed as a "contact" is not an SSN just because it sits in the list
    expect((await write({ publicContacts: [SSN] })).deny).toContain('us-ssn')
  })

  test('blocks an address listed in a malformed or mistyped config', strict, async ($, on) => {
    stubEngine(on, {})
    const text = (content: string) => $.tool.call({ tool: 'Write', file_path: CONFIG, content })
    const denied = async (content: string) => expect((await text(content)).deny).toContain('privacy-guard')

    await denied(`{\n  "publicContacts": [\n    "${PERSON}"\n  ]`)
    await denied(`{\n  "publicContacts": "${PERSON}"\n}`)
    await denied(`{\n  "publicContacts": {\n    "main": "${PERSON}"\n  }\n}`)
    await denied(`{\n  "publicContacts": [\n    { "email": "${PERSON}" }\n  ]\n}`)
    await denied(`{\n  "other": {\n    "publicContacts": [\n      "${PERSON}"\n    ]\n  }\n}`)
    await denied(`[\n  "${PERSON}"\n]`)
    await denied(`{ "publicContacts": ["${PERSON}"], "owner": "${PERSON}" }`)
    await denied(`{\n  "publicContacts": [\n    "${PERSON}"\n  ], "owner": "${PERSON}"\n}`)
    await denied(`{\n  "publicContacts": [\n    "${PERSON}"\n  ],\n  "publicContacts": [\n    "x@y.co"\n  ]\n}`)
    await denied(`{\n  "publicContacts": [\n    "${PERSON} and notes"\n  ]\n}`)
    await denied(`{\n  "publicContacts": [\n    42,\n    "${PERSON}\\n"\n  ]\n}`)
  })

  test('another file with the same content is judged as usual', strict, async ($, on) => {
    stubEngine(on, {})

    const out = await $.tool.call({ tool: 'Write', file_path: '/work/docs/privacy-guard.json', content: pretty({ blockAt: 'low', publicContacts: [PERSON] }) })

    expect(out.deny).toContain('privacy-guard')
  })

  test('a malformed call to the config path passes through without throwing', strict, async ($, on) => {
    stubEngine(on, {})

    const out = await $.tool.call(JSON.parse(wire('Write', { file_path: CONFIG, content: 42 })))

    expect(out.deny).toBeUndefined()
  })
})
