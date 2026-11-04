/**
 * Test helpers: fake host, fake session/events, and a minimal ZIP reader.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const defineTool = (options) => options

export function event (type, seq, data, time = 1_700_000_000_000 + seq) {
  return { type, seq, time, data }
}

export function titleEvent (seq, title) {
  return event('session/title', seq, { title, source: { kind: 'fallback' } })
}

export function turnStart (seq, turn) {
  return event('turn/start', seq, { turn })
}

export function turnEnd (seq, turn, kind = 'completed') {
  return event('turn/end', seq, { turn, reason: { kind } })
}

export function userEvent (seq, text, { source = { kind: 'user' }, files = [], turn = 1 } = {}) {
  const content = []
  if (text.length > 0) content.push({ type: 'text', text })
  for (const file of files) content.push({ type: 'file', attachment: file })
  return event('user/message', seq, { role: 'user', content, source, id: `message-${seq}` })
}

export function assistantEvent (seq, text, { turn = 1, step = 1, toolCalls = [], reasoning = undefined } = {}) {
  const content = []
  if (reasoning !== undefined) content.push({ type: 'reasoning', text: reasoning })
  if (text.length > 0) content.push({ type: 'text', text })
  for (const call of toolCalls) content.push({ type: 'tool-call', ...call })
  return event('assistant/message', seq, { turn, step, message: { role: 'assistant', content } })
}

export function toolCallEvent (seq, { turn = 1, step = 1, callId, name, arguments: args }) {
  return event('tool/call', seq, { turn, step, callId, name, arguments: args })
}

export function toolResultEvent (seq, { turn = 1, step = 1, callId, text }) {
  return event('tool/result', seq, {
    turn,
    step,
    message: {
      role: 'tool',
      source: { kind: 'tool', callId },
      toolCallId: callId,
      content: [{ type: 'text', text }],
    },
  })
}

export function presentedEvent (seq, turn, files) {
  return event('deliverables/presented', seq, { turn, callId: 'call-present', files })
}

export function changesEvent (seq, turn) {
  return event('workspace/changes', seq, { turn })
}

export function fakeSession ({ id = 'session-test', cwd, createdAt = 1_700_000_000_000, events = [] } = {}) {
  const header = { id, cwd, createdAt, agentPreset: 'standard' }
  return {
    id,
    header,
    snapshotEvents: () => events,
  }
}

export function fakeAttachments (files) {
  return {
    fileHostPath: (ref) => files.get(ref.attachmentId),
    imageHostPath: () => undefined,
    readImage: async () => undefined,
    readFileStream: async function * () {},
  }
}

export function fakeCtx ({ events, workspaceSummary } = {}) {
  const ctx = {
    logger: { info: () => {}, error: () => {} },
    get (name) {
      if (name === 'sessions') return { flush: async () => true }
      if (name === 'attachments') return ctx.attachments
      if (name === 'workspaceChanges') {
        return {
          summary: (sessionId, seq) => workspaceSummary?.(sessionId, seq),
        }
      }
      return undefined
    },
    attachments: undefined,
  }
  return ctx
}

export async function tempDir (prefix = 'bundle-test-') {
  return await mkdtemp(path.join(tmpdir(), prefix))
}

export async function writeTempFile (dir, name, content) {
  const file = path.join(dir, name)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
  return file
}

/** Minimal ZIP reader for STORE entries, used to assert archive contents. */
export function readZipEntries (buffer) {
  let eocd = -1
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error('zip: EOCD not found')
  const count = buffer.readUInt16LE(eocd + 10)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  const entries = new Map()
  let pointer = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error('zip: bad central directory signature')
    const method = buffer.readUInt16LE(pointer + 10)
    const crc = buffer.readUInt32LE(pointer + 16)
    const compressedSize = buffer.readUInt32LE(pointer + 20)
    const size = buffer.readUInt32LE(pointer + 24)
    const nameLength = buffer.readUInt16LE(pointer + 28)
    const extraLength = buffer.readUInt16LE(pointer + 30)
    const commentLength = buffer.readUInt16LE(pointer + 32)
    const localOffset = buffer.readUInt32LE(pointer + 42)
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8')
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip: bad local header signature')
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    entries.set(name, {
      method,
      crc,
      compressedSize,
      size,
      data: buffer.subarray(dataStart, dataStart + compressedSize),
    })
    pointer += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
