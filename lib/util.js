/**
 * Shared helpers for the session bundle exporter.
 *
 * @module dsh-session-bundle/util
 */

import { createHash } from 'node:crypto'
import path from 'node:path'

/** Cut a string and report whether it was cut. */
export function truncate (value, max) {
  const text = String(value ?? '')
  if (!Number.isFinite(max) || max <= 0 || text.length <= max) return { text, truncated: false }
  return { text: `${text.slice(0, Math.max(0, Math.floor(max) - 1))}…`, truncated: true }
}

/** Epoch milliseconds as a stable UTC timestamp. */
export function isoTime (ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  return `${new Date(ms).toISOString().replace('T', ' ').slice(0, 19)}Z`
}

/** Human-readable bytes. */
export function formatBytes (bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '?'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** sha256 hex of a buffer. */
export function sha256 (buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Make one filesystem-safe stem, without extension handling. */
export function safeName (value, fallback = 'session') {
  const cleaned = String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, '_')
    .replace(/\s+/gu, ' ')
    .replace(/^[. ]+|[. ]+$/gu, '')
    .slice(0, 80)
  return cleaned.length > 0 ? cleaned : fallback
}

/** Preserve every path segment but sanitize each one for archive output. */
export function safeRelativePath (value, fallback = 'file') {
  const segments = String(value ?? '')
    .replace(/\\/gu, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .map((segment) => safeName(segment, 'file'))
  return segments.length > 0 ? segments.join('/') : fallback
}

/** Session title from the last `session/title` event. */
export function sessionTitle (events, fallback = 'session') {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title.trim().length > 0) {
      return event.data.title.trim()
    }
  }
  return fallback
}

/** Last event of one type. */
export function lastEventOfType (events, type) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === type) return events[index]
  }
  return undefined
}

/** JSONL representation of a session's durable events. */
export function eventsToJsonl (events) {
  return events.map((event) => JSON.stringify(event)).join('\n') + (events.length > 0 ? '\n' : '')
}

/** Markdown target with angle brackets, safe for spaces and parentheses. */
export function markdownTarget (relativePath) {
  return `<${String(relativePath).replace(/>/gu, '%3E')}>`
}

/** Make a unique entry name against a set of already-used names. */
export function uniqueEntryName (used, candidate) {
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }
  const extension = path.posix.extname(candidate)
  const stem = extension.length > 0 ? candidate.slice(0, -extension.length) : candidate
  for (let index = 2; index < 10_000; index += 1) {
    const next = `${stem}-${index}${extension}`
    if (!used.has(next)) {
      used.add(next)
      return next
    }
  }
  throw new Error(`could not make a unique archive name for ${candidate}`)
}

/** Expand a leading `~` in a configured path. */
export function expandHome (value, home) {
  const text = String(value ?? '').trim()
  if (text === '~') return home
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(home, text.slice(2))
  return text
}
