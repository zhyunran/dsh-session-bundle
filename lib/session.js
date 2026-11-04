/**
 * Session snapshot and metadata extraction.
 *
 * @module dsh-session-bundle/session
 */

import { lastEventOfType, sessionTitle } from './util.js'

/**
 * Flush the live session and return its durable event snapshot.
 *
 * @param {any} ctx plugin context (optional `sessions` service).
 * @param {any} session live Session.
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function snapshotSession (ctx, session) {
  if (session === undefined || session === null) throw new Error('no Session is attached to this call')
  const sessions = ctx.get('sessions')
  if (sessions && typeof sessions.flush === 'function') {
    try {
      await sessions.flush(session)
    } catch {
      /* the snapshot below still contains the in-memory prefix */
    }
  }
  const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
  if (!Array.isArray(events)) throw new Error('Session.snapshotEvents() did not return an event list')
  return events
}

/** Last provider/model this session used, when recorded. */
function modelOf (events) {
  const context = lastEventOfType(events, 'request/context')
  if (context && typeof context.data?.provider === 'string' && typeof context.data?.model === 'string') {
    return { provider: context.data.provider, model: context.data.model }
  }
  const header = lastEventOfType(events, 'request/header')
  const config = header?.data?.header?.config
  if (config && typeof config.provider === 'string' && typeof config.model === 'string') {
    return { provider: config.provider, model: config.model }
  }
  return undefined
}

/**
 * Build the metadata block used by the Markdown header and manifest.
 *
 * @param {any} session live Session.
 * @param {ReadonlyArray<Record<string, any>>} events
 */
export function sessionMeta (session, events) {
  const header = session.header ?? {}
  const turns = new Set()
  let messages = 0
  let toolCalls = 0
  let lastSeq = -1
  let firstTime
  for (const event of events) {
    if (typeof event.seq === 'number' && event.seq > lastSeq) lastSeq = event.seq
    if (typeof event.time === 'number' && firstTime === undefined) firstTime = event.time
    if (event.type === 'turn/start' && typeof event.data?.turn === 'number') turns.add(event.data.turn)
    if (event.type === 'user/message' || event.type === 'assistant/message') messages += 1
    if (event.type === 'tool/call') toolCalls += 1
  }
  const model = modelOf(events)
  return {
    id: typeof header.id === 'string' ? header.id : String(session.id ?? ''),
    title: sessionTitle(events, ''),
    cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
    createdAt: typeof header.createdAt === 'number' ? header.createdAt : firstTime,
    agentPreset: typeof header.agentPreset === 'string' ? header.agentPreset : undefined,
    ...(model === undefined ? {} : { model }),
    turns: turns.size,
    messages,
    toolCalls,
    lastSeq,
  }
}

/** Read one event's declared content arrays, matching the exporter policy. */
export function contentOfEvent (event) {
  switch (event?.type) {
    case 'user/message':
      return Array.isArray(event.data?.content) ? event.data.content : []
    case 'assistant/message':
      return Array.isArray(event.data?.message?.content) ? event.data.message.content : []
    case 'tool/result':
      return Array.isArray(event.data?.message?.content) ? event.data.message.content : []
    default:
      return []
  }
}
