import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { BUILTIN_RULES, scrub } from '../hooks/patterns'

// Samples are assembled from parts so this file never holds a live-looking
// secret that a repository scanner would flag.
const GITHUB = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
const GOOGLE = 'AIza' + 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'
const AWS_ID = 'AKIA' + 'IOSFODNN7EXAMPLE'
const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/' + 'bPxRfiCYEXAMPLEKEY'
const JWT = 'eyJhbGciOiJIUzI1NiJ9' + '.eyJzdWIiOiIxMjM0NTY3ODkwIn0' + '.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
const TODOIST = '0123456789abcdef' + '0123456789abcdef01234567'
const VERCEL = 'Ab3dEf6hIj9kLm2nOp5qRs8t'
const KEY_BLOCK = ['-----BEGIN RSA ' + 'PRIVATE KEY-----', 'MIIEowIBAAKCAQEAx', '-----END RSA ' + 'PRIVATE KEY-----'].join('\n')

describe('scrub', () => {
  test('redacts each provider token by name', () => {
    const cases: [string, string][] = [
      [`token ${GITHUB}`, 'github-token'],
      [`key=${GOOGLE}`, 'google-api-key'],
      [`id ${AWS_ID}`, 'aws-access-key-id'],
      [`aws_secret_access_key = ${AWS_SECRET}`, 'aws-secret-access-key'],
      [`auth ${JWT}`, 'jwt'],
      [`TODOIST_API_TOKEN=${TODOIST}`, 'todoist-token'],
      [`VERCEL_TOKEN=${VERCEL}`, 'vercel-token'],
      [KEY_BLOCK, 'private-key'],
    ]
    for (const [text, kind] of cases) {
      const done = scrub(text, BUILTIN_RULES)
      expect(done.count, text).toBe(1)
      expect(done.text).toContain(`[REDACTED:${kind}]`)
    }
  })

  test('keeps the label of a generic key=value secret', () => {
    const done = scrub('DB_PASSWORD=hunter22 and "apiKey": "k3y-value-123"', BUILTIN_RULES)
    expect(done.text).toBe('DB_PASSWORD=[REDACTED:generic-secret] and "apiKey": "[REDACTED:generic-secret]"')
    expect(done.count).toBe(2)
  })

  test('leaves code and ordinary text alone', () => {
    const text = [
      'const token = getToken()',
      'apiKey: process.env.API_KEY',
      'password: string',
      'the tokenizer splits words',
      'commit 3f930c6 Initial commit',
    ].join('\n')
    expect(scrub(text, BUILTIN_RULES)).toEqual({ text, count: 0, kinds: [] })
  })

  test('blanks every value of a .env file', () => {
    const done = scrub('# local\nPORT=3000\nexport DATABASE_URL=postgres://localhost/db\nEMPTY=\n', BUILTIN_RULES, true)
    expect(done.text).toBe('# local\nPORT=[REDACTED:env-value]\nexport DATABASE_URL=[REDACTED:env-value]\nEMPTY=\n')
    expect(done.count).toBe(2)
  })
})

/** Stubs every display and file call the mod makes, and collects the status lines. */
function stubEngine(on: On, configFile?: string) {
  const status: (string | undefined)[] = []
  const toasts: string[] = []
  on('fs.exists', ($, e) => ({ value: configFile !== undefined && e.path.endsWith('secret-scrubber.json') }))
  on('fs.read', () => ({ value: configFile ?? '' }))
  on('ui.status', ($, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'ok' }))
  return { status, toasts }
}

const toolResult = (id: string, content: unknown) => ({
  message: { type: 'user' as const, role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: id, content }] },
  door: 'tool-result' as const,
  origin: { kind: 'tool' as const, tool: 'Bash' },
  uuid: `row-${id}`,
})

const firstResult = (rows: readonly { message: { content: { type: string; [k: string]: unknown }[] } }[]) =>
  rows.at(-1)?.message.content[0]?.content

test('redacts a token from tool output before Claude reads it, and counts it', async ($, on) => {
  const { status, toasts } = stubEngine(on)
  const session = mock.session(on)

  await $.session.append(toolResult('t1', `export GITHUB_TOKEN=${GITHUB}`))

  expect(firstResult(session.appended())).toBe('export GITHUB_TOKEN=[REDACTED:github-token]')
  expect(status).toEqual(['🔒 1 secret redacted'])
  expect(toasts[0]).toContain('redacted 1 from Bash output (github-token)')
})

test('scrubs text blocks inside a tool result and keeps a running count', async ($, on) => {
  const { status } = stubEngine(on)
  const session = mock.session(on)

  await $.session.append(toolResult('t1', [{ type: 'text', text: `k ${GOOGLE} and ${AWS_ID}` }]))
  await $.session.append(toolResult('t2', `jwt ${JWT}`))

  expect(firstResult(session.appended())).toBe('jwt [REDACTED:jwt]')
  expect(status).toEqual(['🔒 2 secrets redacted', '🔒 3 secrets redacted'])
})

test('treats a Read of .env as secret through and through', async ($, on) => {
  stubEngine(on)
  const session = mock.session(on)

  await $.tool.call({ tool: 'Read', file_path: '/work/.env.local', tool_use_id: 'r1' })
  await $.session.append(toolResult('r1', 'PORT=3000\nNAME=demo'))

  expect(firstResult(session.appended())).toBe('PORT=[REDACTED:env-value]\nNAME=[REDACTED:env-value]')
})

test('passes clean output through untouched and shows nothing', async ($, on) => {
  const { status, toasts } = stubEngine(on)
  const session = mock.session(on)

  await $.session.append(toolResult('t1', 'total 0\ndrwxr-xr-x  2 me  staff  64 src'))

  expect(firstResult(session.appended())).toBe('total 0\ndrwxr-xr-x  2 me  staff  64 src')
  expect(status).toEqual([])
  expect(toasts).toEqual([])
})

test('does nothing when the project config turns it off', async ($, on) => {
  const { status } = stubEngine(on, JSON.stringify({ enabled: false }))
  const session = mock.session(on)

  await $.session.append(toolResult('t1', `token ${GITHUB}`))

  expect(firstResult(session.appended())).toBe(`token ${GITHUB}`)
  expect(status).toEqual([])
})

test('adds custom patterns from the project config', async ($, on) => {
  stubEngine(on, JSON.stringify({ patterns: [{ name: 'Acme Key', pattern: 'acme_[0-9]{6}' }], showToast: false }))
  const session = mock.session(on)

  await $.session.append(toolResult('t1', 'key acme_123456'))

  expect(firstResult(session.appended())).toBe('key [REDACTED:acme-key]')
})

test('is off when the enabled option is false', { options: { enabled: false } }, async ($, on) => {
  stubEngine(on)
  const session = mock.session(on)

  await $.session.append(toolResult('t1', `token ${GITHUB}`))

  expect(firstResult(session.appended())).toBe(`token ${GITHUB}`)
})

test('scrubs a subagent tool result and says where it came from', async ($, on) => {
  const { toasts } = stubEngine(on)
  const session = mock.session(on)

  await $.session.append({ ...toolResult('s1', `key ${GOOGLE}`), agentId: 'agent-1' })

  expect(firstResult(session.appended())).toBe('key [REDACTED:google-api-key]')
  expect(toasts[0]).toBe('secret-scrubber: redacted 1 from Bash output in a subagent (google-api-key)')
})

test('scrubs a subagent report on its way back to the main conversation', async ($, on) => {
  stubEngine(on)
  const session = mock.session(on)

  await $.session.append({ ...toolResult('a1', [{ type: 'text', text: `Found the deploy key: ${GITHUB}` }]), origin: { kind: 'tool', tool: 'Agent' } })

  expect(session.appended().at(-1)?.message.content[0]?.content).toEqual([{ type: 'text', text: 'Found the deploy key: [REDACTED:github-token]' }])
})

test('scrubs an @-mentioned file, counting it once however many requests carry it', async ($, on) => {
  const { status } = stubEngine(on)
  on('prompt.attachment', ($, e) => ({ text: e.text }))

  const attachment = { type: 'file', text: `config.ts:\nconst key = "${GOOGLE}"`, origin: { kind: 'engine' as const } }
  const first = await $.prompt.attachment(attachment)
  const second = await $.prompt.attachment(attachment)

  expect(first.text).toBe('config.ts:\nconst key = "[REDACTED:google-api-key]"')
  expect(second.text).toBe(first.text)
  expect(status).toEqual(['🔒 1 secret redacted'])
})

test('blanks every value of an @-mentioned .env file', async ($, on) => {
  stubEngine(on)
  on('prompt.mention', () => ({ type: null }))
  on('prompt.attachment', ($, e) => ({ text: e.text }))

  await $.prompt.mention({ mention: '.env', path: '/work/.env' })
  const out = await $.prompt.attachment({ type: 'file', text: 'Contents of /work/.env:\nPORT=3000\nNAME=demo', origin: { kind: 'engine' } })

  expect(out.text).toBe('Contents of /work/.env:\nPORT=[REDACTED:env-value]\nNAME=[REDACTED:env-value]')
})

test('leaves a clean attachment as it was', async ($, on) => {
  stubEngine(on)
  on('prompt.attachment', ($, e) => ({ text: e.text }))

  const out = await $.prompt.attachment({ type: 'todo_reminder', text: 'Remember the todo list.', origin: { kind: 'engine' } })

  expect(out.text).toBe('Remember the todo list.')
})
