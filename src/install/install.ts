// Installing into a project without destroying anything of its own.
//
// Rules:
//  - A file ModsPack did not write is never overwritten. If it already holds
//    exactly what we would write it is adopted; otherwise it is a conflict.
//  - A file ModsPack wrote is refreshed only while nobody has edited it
//    (its hash still matches the manifest).
//  - Instruction files (CLAUDE.md, AGENTS.md, GEMINI.md) get one marked
//    block; everything outside it is left byte for byte.
//  - Hook settings that already exist (.codex/hooks.json, .gemini/settings.json)
//    get one entry merged in, and uninstall removes only that entry.
//  - Everything installed is recorded in .modspack/manifest.json.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { BLOCK_END, BLOCK_START } from '../adapters/render'
import type { Output, OutBlock, OutFile, OutMerge } from '../adapters/render'

export const MANIFEST = '.modspack/manifest.json'

export type Manifest = {
  version: number
  package: string
  installedWith: string
  platforms: string[]
  files: Record<string, { sha256: string }>
  blocks: Record<string, { sha256: string; createdFile: boolean }>
  merges: Record<string, { platform: string; createdFile: boolean }>
}

export type Action =
  | { op: 'create' | 'update' | 'unchanged' | 'adopt'; path: string; detail: string; out: Output }
  | { op: 'conflict' | 'keep-edited'; path: string; detail: string; out: Output }

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

export function readManifest(dir: string): Manifest | undefined {
  const file = path.join(dir, MANIFEST)
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Manifest
  } catch {
    return undefined
  }
}

const readIf = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined)

function blockRange(text: string): { start: number; end: number } | undefined {
  const start = text.indexOf(BLOCK_START)
  if (start < 0) return undefined
  const endAt = text.indexOf(BLOCK_END, start)
  if (endAt < 0) return undefined
  let end = endAt + BLOCK_END.length
  if (text[end] === '\n') end += 1
  return { start, end }
}

const isOurEntry = (entry: unknown): boolean => JSON.stringify(entry ?? '').includes('modspack hook ')

type HookSettings = { hooks?: Record<string, unknown[]> }
const mergeEvent: Record<string, string> = { codex: 'PreToolUse', gemini: 'BeforeTool' }

export function plan(dir: string, outputs: readonly Output[], manifest: Manifest | undefined): Action[] {
  return outputs.map((out): Action => {
    const abs = path.join(dir, out.path)
    const current = readIf(abs)
    if (out.kind === 'file') {
      if (current === undefined) return { op: 'create', path: out.path, detail: 'new file', out }
      const recorded = manifest?.files[out.path]?.sha256
      if (current === out.content) return { op: recorded ? 'unchanged' : 'adopt', path: out.path, detail: recorded ? 'up to date' : 'already identical; will be tracked', out }
      if (recorded !== undefined && recorded === sha256(current)) return { op: 'update', path: out.path, detail: 'newer ModsPack version', out }
      if (recorded !== undefined) return { op: 'keep-edited', path: out.path, detail: 'edited since install; left alone', out }
      return { op: 'conflict', path: out.path, detail: 'exists and is not a ModsPack file; left alone', out }
    }
    if (out.kind === 'block') {
      if (current === undefined) return { op: 'create', path: out.path, detail: 'new file holding the ModsPack block', out }
      const range = blockRange(current)
      if (range === undefined) return { op: 'create', path: out.path, detail: 'append a marked block; the rest of the file is untouched', out }
      const existing = current.slice(range.start, range.end)
      if (existing === out.content) return { op: 'unchanged', path: out.path, detail: 'block up to date', out }
      const recorded = manifest?.blocks[out.path]?.sha256
      if (recorded !== undefined && recorded !== sha256(existing)) return { op: 'keep-edited', path: out.path, detail: 'block edited since install; left alone', out }
      return { op: 'update', path: out.path, detail: 'refresh the marked block', out }
    }
    // json-merge
    if (current === undefined) return { op: 'create', path: out.path, detail: 'new settings file with the hook entry', out }
    let parsed: HookSettings
    try {
      parsed = JSON.parse(current) as HookSettings
    } catch {
      return { op: 'conflict', path: out.path, detail: 'not valid JSON; fix it by hand, then re-run', out }
    }
    const event = mergeEvent[out.platform] ?? ''
    const list = parsed.hooks?.[event]
    if (Array.isArray(list) && list.some(isOurEntry)) return { op: 'unchanged', path: out.path, detail: 'hook entry present', out }
    return { op: 'update', path: out.path, detail: `add one ${event} hook entry; existing entries untouched`, out }
  })
}

function write(dir: string, rel: string, text: string) {
  const abs = path.join(dir, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, text)
}

export function apply(dir: string, actions: readonly Action[], previous: Manifest | undefined, meta: { version: string; platforms: string[] }): Manifest {
  const manifest: Manifest = {
    version: 1,
    package: 'one-small-modspack',
    installedWith: meta.version,
    platforms: meta.platforms,
    files: { ...previous?.files },
    blocks: { ...previous?.blocks },
    merges: { ...previous?.merges },
  }
  for (const action of actions) {
    const { out } = action
    const writes = action.op === 'create' || action.op === 'update'
    if (out.kind === 'file') {
      if (writes || action.op === 'adopt') {
        if (writes) write(dir, out.path, out.content)
        manifest.files[out.path] = { sha256: sha256(out.content) }
      }
    } else if (out.kind === 'block') {
      if (writes) {
        const abs = path.join(dir, out.path)
        const current = readIf(abs)
        let next: string
        let createdFile = manifest.blocks[out.path]?.createdFile ?? false
        if (current === undefined) {
          next = out.content
          createdFile = true
        } else {
          const range = blockRange(current)
          if (range === undefined) next = current + (current === '' ? '' : current.endsWith('\n') ? '\n' : '\n\n') + out.content
          else next = current.slice(0, range.start) + out.content + current.slice(range.end)
        }
        write(dir, out.path, next)
        manifest.blocks[out.path] = { sha256: sha256(out.content), createdFile }
      } else if (action.op === 'unchanged' && manifest.blocks[out.path] === undefined) {
        manifest.blocks[out.path] = { sha256: sha256(out.content), createdFile: false }
      }
    } else if (writes) {
      const abs = path.join(dir, out.path)
      const current = readIf(abs)
      const settings: HookSettings = current === undefined ? {} : (JSON.parse(current) as HookSettings)
      const event = mergeEvent[out.platform] ?? ''
      settings.hooks ??= {}
      const list = (settings.hooks[event] ??= [])
      list.push(out.entry)
      write(dir, out.path, JSON.stringify(settings, null, 2) + '\n')
      manifest.merges[out.path] = { platform: out.platform, createdFile: manifest.merges[out.path]?.createdFile ?? current === undefined }
    }
  }
  write(dir, MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

export type RemoveAction = { path: string; op: 'remove' | 'remove-block' | 'remove-hook' | 'keep-edited' | 'missing'; detail: string }

export function planUninstall(dir: string, manifest: Manifest): RemoveAction[] {
  const out: RemoveAction[] = []
  for (const [rel, info] of Object.entries(manifest.files)) {
    const current = readIf(path.join(dir, rel))
    if (current === undefined) out.push({ path: rel, op: 'missing', detail: 'already gone' })
    else if (sha256(current) === info.sha256) out.push({ path: rel, op: 'remove', detail: 'unmodified; will be deleted' })
    else out.push({ path: rel, op: 'keep-edited', detail: 'edited since install; kept' })
  }
  for (const [rel, info] of Object.entries(manifest.blocks)) {
    const current = readIf(path.join(dir, rel))
    const range = current === undefined ? undefined : blockRange(current)
    if (current === undefined || range === undefined) out.push({ path: rel, op: 'missing', detail: 'block already gone' })
    else if (sha256(current.slice(range.start, range.end)) === info.sha256) out.push({ path: rel, op: 'remove-block', detail: 'unmodified block; will be removed' })
    else out.push({ path: rel, op: 'keep-edited', detail: 'block edited since install; kept' })
  }
  for (const rel of Object.keys(manifest.merges)) {
    const current = readIf(path.join(dir, rel))
    if (current === undefined) out.push({ path: rel, op: 'missing', detail: 'file already gone' })
    else out.push({ path: rel, op: 'remove-hook', detail: 'ModsPack hook entry will be removed; other entries kept' })
  }
  return out
}

export function applyUninstall(dir: string, manifest: Manifest, actions: readonly RemoveAction[]) {
  const dropEmptyDirs = (rel: string) => {
    let current = path.dirname(path.join(dir, rel))
    while (current !== dir && current.startsWith(dir)) {
      try {
        rmSync(current, { recursive: false })
      } catch {
        return
      }
      current = path.dirname(current)
    }
  }
  for (const action of actions) {
    const abs = path.join(dir, action.path)
    if (action.op === 'remove') {
      rmSync(abs, { force: true })
      dropEmptyDirs(action.path)
    } else if (action.op === 'remove-block') {
      const current = readFileSync(abs, 'utf8')
      const range = blockRange(current)
      if (range === undefined) continue
      let next = current.slice(0, range.start) + current.slice(range.end)
      // Our append added a blank line before the block: take it back.
      if (range.start > 0 && next.slice(0, range.start).endsWith('\n\n') && !manifest.blocks[action.path]?.createdFile) next = next.slice(0, range.start - 1) + next.slice(range.start)
      if (next.trim() === '' && manifest.blocks[action.path]?.createdFile) rmSync(abs, { force: true })
      else writeFileSync(abs, next)
    } else if (action.op === 'remove-hook') {
      const settings = JSON.parse(readFileSync(abs, 'utf8')) as HookSettings
      for (const [event, list] of Object.entries(settings.hooks ?? {})) {
        const kept = list.filter(entry => !isOurEntry(entry))
        if (kept.length > 0) settings.hooks![event] = kept
        else delete settings.hooks![event]
      }
      if (settings.hooks !== undefined && Object.keys(settings.hooks).length === 0) delete settings.hooks
      if (Object.keys(settings).length === 0 && manifest.merges[action.path]?.createdFile) {
        rmSync(abs, { force: true })
        dropEmptyDirs(action.path)
      } else writeFileSync(abs, JSON.stringify(settings, null, 2) + '\n')
    }
  }
  const remaining = actions.some(a => a.op === 'keep-edited')
  if (!remaining) {
    rmSync(path.join(dir, MANIFEST), { force: true })
    dropEmptyDirs(MANIFEST)
  } else {
    // Keep a manifest of what is left so a later uninstall can finish the job.
    const left = planUninstall(dir, manifest).filter(a => a.op === 'keep-edited').map(a => a.path)
    const next: Manifest = { ...manifest, files: {}, blocks: {}, merges: {} }
    for (const rel of left) {
      if (manifest.files[rel]) next.files[rel] = manifest.files[rel]!
      if (manifest.blocks[rel]) next.blocks[rel] = manifest.blocks[rel]!
    }
    write(dir, MANIFEST, JSON.stringify(next, null, 2) + '\n')
  }
}

export type DoctorRow = { path: string; status: 'ok' | 'missing' | 'edited'; detail: string }

/** Whether everything the manifest lists is present and unmodified. */
export function doctorRows(dir: string, manifest: Manifest): DoctorRow[] {
  const rows: DoctorRow[] = []
  for (const [rel, info] of Object.entries(manifest.files)) {
    const current = readIf(path.join(dir, rel))
    rows.push(current === undefined ? { path: rel, status: 'missing', detail: 'run modspack init --yes to restore it' } : sha256(current) === info.sha256 ? { path: rel, status: 'ok', detail: '' } : { path: rel, status: 'edited', detail: 'differs from what ModsPack wrote (fine if intended)' })
  }
  for (const [rel, info] of Object.entries(manifest.blocks)) {
    const current = readIf(path.join(dir, rel))
    const range = current === undefined ? undefined : blockRange(current)
    rows.push(range === undefined || current === undefined ? { path: rel, status: 'missing', detail: 'ModsPack block not found' } : sha256(current.slice(range.start, range.end)) === info.sha256 ? { path: rel, status: 'ok', detail: 'block' } : { path: rel, status: 'edited', detail: 'block edited' })
  }
  for (const rel of Object.keys(manifest.merges)) {
    const current = readIf(path.join(dir, rel))
    let ok = false
    try {
      ok = current !== undefined && JSON.stringify(JSON.parse(current)).includes('modspack hook ')
    } catch {
      ok = false
    }
    rows.push({ path: rel, status: ok ? 'ok' : 'missing', detail: ok ? 'hook entry' : 'hook entry not found' })
  }
  return rows
}

export type { OutBlock, OutFile, OutMerge }
