/**
 * Render a session event log as a human-readable Markdown transcript.
 *
 * Deliberately reader-first: user and assistant prose is the spine, tool calls
 * and results are collapsible details, attachments and changed files are links
 * into the bundle, and machine-only events (system prompts, request headers,
 * inbox splices, command bookkeeping) are omitted.
 *
 * @module dsh-session-bundle/markdown
 */

import path from 'node:path'
import { isoTime, markdownTarget, truncate } from './util.js'

function fence (text) {
  const body = String(text ?? '')
  let ticks = '```'
  while (body.includes(ticks)) ticks += '`'
  return `${ticks}\n${body}\n${ticks}`
}

function prettyArguments (raw) {
  if (typeof raw !== 'string' || raw.length === 0) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function blockText (block) {
  if (block === null || typeof block !== 'object') return ''
  if (block.type === 'text') return typeof block.text === 'string' ? block.text : ''
  if (block.type === 'file' || block.type === 'image') {
    const ref = block.attachment ?? {}
    const name = typeof ref.name === 'string' && ref.name.length > 0 ? ref.name : (block.type === 'image' ? 'image' : 'file')
    return `[${block.type}: ${name}]`
  }
  return ''
}

function splitContent (content, attachmentPaths, options) {
  const text = []
  const attachments = []
  const toolCalls = []
  const reasoning = []
  for (const block of Array.isArray(content) ? content : []) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text') {
      if (typeof block.text === 'string' && block.text.length > 0) text.push(block.text)
      continue
    }
    if (block.type === 'file' || block.type === 'image') {
      const ref = block.attachment ?? {}
      const attachmentId = typeof ref.attachmentId === 'string' ? ref.attachmentId : undefined
      const name = typeof ref.name === 'string' && ref.name.length > 0 ? ref.name : (block.type === 'image' ? 'image' : 'file')
      const zipPath = attachmentId === undefined ? undefined : attachmentPaths.get(attachmentId)
      attachments.push({ name, zipPath, type: block.type })
      continue
    }
    if (block.type === 'tool-call') {
      toolCalls.push(block)
      continue
    }
    if (block.type === 'reasoning' && typeof block.text === 'string' && block.text.length > 0) {
      reasoning.push(block.text)
    }
  }
  return { text: text.join('\n').trim(), attachments, toolCalls, reasoning }
}

function attachmentLines (attachments) {
  if (attachments.length === 0) return []
  const lines = []
  for (const attachment of attachments) {
    if (attachment.zipPath !== undefined) {
      lines.push(`- [${attachment.name}](${markdownTarget(attachment.zipPath)})`)
    } else {
      lines.push(`- ${attachment.name} _(attachment bytes not available)_`)
    }
  }
  return lines
}

function truncateNote (wasTruncated) {
  return wasTruncated ? '_(truncated)_' : ''
}

function toolCallBlock (block, options) {
  const name = typeof block.name === 'string' ? block.name : 'tool'
  const args = truncate(prettyArguments(block.arguments), options.maxToolChars)
  return [
    '<details>',
    `<summary>Tool call — <code>${escapeHtml(name)}</code></summary>`,
    '',
    fence(args.text),
    '',
    ...(args.truncated ? ['_(arguments truncated)_', ''] : []),
    '</details>',
  ].join('\n')
}

function escapeHtml (value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;',
  })[character])
}

function sourceLabel (source) {
  if (source === null || typeof source !== 'object') return 'unknown'
  if (source.kind === 'agent-message' && typeof source.senderSessionId === 'string') {
    return `agent message from \`${source.senderSessionId}\``
  }
  if (source.kind === 'subagent-settled' && typeof source.senderSessionId === 'string') {
    return `subagent settled: \`${source.senderSessionId}\``
  }
  return typeof source.kind === 'string' ? source.kind : 'unknown'
}

const CONVERSATIONAL_SOURCES = new Set([
  'user',
  'agent-message',
  'team-message',
  'schedule',
  'webhook',
  'subagent-settled',
  'user-question-reply',
  'skill-invocation',
  'goal',
])

function isConversationalSource (source) {
  return source !== null && typeof source === 'object' && CONVERSATIONAL_SOURCES.has(source.kind)
}

function changesForTurn (changesByTurn, turn) {
  return changesByTurn.get(turn) ?? []
}

function renderChangeLines (change, filesBySource) {
  const lines = []
  const files = Array.isArray(change.files) ? change.files : []
  if (files.length === 0) return lines
  lines.push('')
  lines.push(`**Files changed this turn:** ${change.listed ?? files.length}${typeof change.total === 'number' && change.total > files.length ? ` of ${change.total}` : ''}`)
  for (const file of files) {
    const counts = typeof file.added === 'number' || typeof file.deleted === 'number'
      ? ` (+${file.added ?? 0}/-${file.deleted ?? 0})`
      : ''
    const zipPath = file.zipPath ?? (file.path === undefined ? undefined : filesBySource.get(path.resolve(file.path)))
    const target = zipPath === undefined ? '' : ` → [copy](${markdownTarget(zipPath)})`
    lines.push(`- \`${file.display ?? file.path}\`${counts}${target}`)
  }
  return lines
}

/**
 * Render the bundle's conversation Markdown.
 *
 * @param {{
 *   session: any,
 *   events: ReadonlyArray<Record<string, any>>,
 *   meta: Record<string, any>,
 *   files: ReadonlyArray<Record<string, any>>,
 *   attachmentPaths: Map<string, string>,
 *   changes: ReadonlyArray<Record<string, any>>,
 *   options: Readonly<Record<string, any>>,
 *   generatedAt: number,
 *   source: string,
 * }} input
 * @returns {string}
 */
export function renderConversation (input) {
  const { session, events, meta, files, attachmentPaths, changes, options, generatedAt, source } = input
  const title = meta.title && meta.title.length > 0 ? meta.title : 'DSH session'
  const lines = []
  let injectedContext = 0
  if (options.includeInjectedContext !== true) {
    for (const event of events) {
      if (event.type === 'user/message' && !isConversationalSource(event.data?.source)) injectedContext += 1
    }
  }
  lines.push(`# ${title}`)
  lines.push('')
  lines.push(`- Session: \`${meta.id}\``)
  if (meta.cwd !== undefined) lines.push(`- Working directory: \`${meta.cwd}\``)
  if (meta.createdAt !== undefined) lines.push(`- Created: ${isoTime(meta.createdAt)}`)
  lines.push(`- Exported: ${isoTime(generatedAt)} (${source})`)
  if (meta.model !== undefined) lines.push(`- Model: \`${meta.model.provider}/${meta.model.model}\``)
  lines.push(`- Turns: ${meta.turns} · Messages: ${meta.messages} · Tool calls: ${meta.toolCalls} · Last seq: ${meta.lastSeq}`)
  lines.push('')
  lines.push('> System prompts, developer messages, request headers and reasoning (unless enabled) are omitted from this readable copy. `session.v4.jsonl` keeps the raw durable log.')
  if (injectedContext > 0) {
    lines.push(`> ${injectedContext} injected context message(s) (agent instructions, runtime context, approvals, job notices) are omitted. Set includeInjectedContext: true to include them.`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')

  const filesBySource = new Map()
  for (const file of files) {
    if (typeof file.sourcePath === 'string') filesBySource.set(path.resolve(file.sourcePath), file.zipPath)
  }
  const changesByTurn = new Map()
  for (const change of changes) {
    if (typeof change.turn !== 'number') continue
    if (!changesByTurn.has(change.turn)) changesByTurn.set(change.turn, [])
    changesByTurn.get(change.turn).push(change)
  }

  const callNames = new Map()
  let currentTurn
  let renderedTurn
  let wroteAnything = false

  const ensureTurn = (turn) => {
    wroteAnything = true
    if (renderedTurn === turn) return
    renderedTurn = turn
    if (typeof turn === 'number') {
      lines.push(`## Turn ${turn}`)
      lines.push('')
    }
  }

  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        currentTurn = event.data?.turn
        break
      case 'user/message': {
        if (options.includeInjectedContext !== true && !isConversationalSource(event.data?.source)) break
        const turn = typeof event.data?.turn === 'number' ? event.data.turn : currentTurn
        ensureTurn(turn)
        const content = splitContent(event.data?.content, attachmentPaths, options)
        const body = truncate(content.text, options.maxMessageChars)
        lines.push(`### User · seq ${event.seq} · ${isoTime(event.time)} · ${sourceLabel(event.data?.source)}`)
        lines.push('')
        if (body.text.length > 0) {
          lines.push(body.text.split(/\r?\n/).map((line) => `> ${line}`).join('\n'))
          lines.push('')
          if (body.truncated) lines.push('> _(message truncated)_', '')
        }
        const attachments = attachmentLines(content.attachments)
        if (attachments.length > 0) {
          lines.push(...attachments)
          lines.push('')
        }
        break
      }
      case 'assistant/message': {
        const data = event.data ?? {}
        const content = splitContent(data.message?.content, attachmentPaths, options)
        ensureTurn(typeof data.turn === 'number' ? data.turn : currentTurn)
        const body = truncate(content.text, options.maxMessageChars)
        lines.push(`### Assistant · seq ${event.seq} · ${isoTime(event.time)}`)
        lines.push('')
        if (body.text.length > 0) {
          lines.push(body.text)
          lines.push('')
          if (body.truncated) lines.push('_(message truncated)_', '')
        }
        if (options.includeReasoning && content.reasoning.length > 0) {
          const reasoning = truncate(content.reasoning.join('\n\n'), options.maxToolChars)
          lines.push('<details>', '<summary>Reasoning</summary>', '', fence(reasoning.text), '', ...(reasoning.truncated ? ['_(truncated)_', ''] : []), '</details>', '')
        }
        for (const call of content.toolCalls) {
          if (typeof call.id === 'string' && typeof call.name === 'string') callNames.set(call.id, call.name)
          lines.push(toolCallBlock(call, options))
          lines.push('')
        }
        const attachments = attachmentLines(content.attachments)
        if (attachments.length > 0) {
          lines.push(...attachments)
          lines.push('')
        }
        break
      }
      case 'tool/call': {
        if (typeof event.data?.callId === 'string' && typeof event.data?.name === 'string') {
          callNames.set(event.data.callId, event.data.name)
        }
        break
      }
      case 'tool/result': {
        const data = event.data ?? {}
        const content = splitContent(data.message?.content, attachmentPaths, options)
        const callId = typeof data.message?.toolCallId === 'string' ? data.message.toolCallId : undefined
        const name = callId === undefined ? 'tool' : (callNames.get(callId) ?? 'tool')
        ensureTurn(typeof data.turn === 'number' ? data.turn : currentTurn)
        const body = truncate(content.text, options.maxToolChars)
        lines.push('<details>')
        lines.push(`<summary>Tool result — <code>${escapeHtml(name)}</code>${callId === undefined ? '' : ` · ${escapeHtml(callId)}`}</summary>`)
        lines.push('')
        if (body.text.length > 0) {
          lines.push(fence(body.text))
          lines.push('')
        }
        if (body.truncated) lines.push('_(result truncated)_', '')
        const attachments = attachmentLines(content.attachments)
        if (attachments.length > 0) {
          lines.push(...attachments)
          lines.push('')
        }
        lines.push('</details>')
        lines.push('')
        break
      }
      case 'deliverables/presented': {
        ensureTurn(typeof event.data?.turn === 'number' ? event.data.turn : currentTurn)
        const files = Array.isArray(event.data?.files) ? event.data.files : []
        if (files.length > 0) {
          lines.push('**Presented files**')
          for (const file of files) {
            if (file === null || typeof file !== 'object' || typeof file.path !== 'string') continue
            const zipPath = filesBySource.get(path.resolve(session.header?.cwd ?? process.cwd(), file.path))
            const target = zipPath === undefined ? '' : ` → [copy](${markdownTarget(zipPath)})`
            const description = typeof file.description === 'string' && file.description.length > 0 ? ` — ${file.description}` : ''
            lines.push(`- \`${file.path}\`${description}${target}`)
          }
          lines.push('')
        }
        break
      }
      case 'turn/end': {
        const turn = typeof event.data?.turn === 'number' ? event.data.turn : currentTurn
        if (turn === renderedTurn) {
          const changeLines = changesForTurn(changesByTurn, turn).flatMap((change) => renderChangeLines(change, filesBySource))
          if (changeLines.length > 0) lines.push(...changeLines, '')
          const reason = event.data?.reason
          const label = reason !== null && typeof reason === 'object' && typeof reason.kind === 'string' ? reason.kind : 'ended'
          lines.push(`_Turn ${turn} ended: ${label}._`)
          lines.push('')
          lines.push('---')
          lines.push('')
          renderedTurn = undefined
        }
        currentTurn = undefined
        break
      }
      default:
        break
    }
  }

  if (!wroteAnything && changes.length === 0) {
    lines.push('_This session has no user/assistant messages yet._', '')
  }

  // A session can have file changes but no readable message (blank/aborted
  // turn); still show the change list rather than dropping it.
  if (!wroteAnything && changes.length > 0) {
    for (const change of changes) lines.push(...renderChangeLines(change, filesBySource))
    lines.push('')
  }

  if (files.length > 0) {
    lines.push('## Bundled files')
    lines.push('')
    lines.push('| Kind | Source | In bundle | Size |')
    lines.push('|---|---|---|---|')
    const order = { attachment: 0, produced: 1, 'workspace-changed': 2, 'workspace-scan': 3 }
    const sorted = [...files].sort((left, right) => (order[left.kind] ?? 9) - (order[right.kind] ?? 9) || left.zipPath.localeCompare(right.zipPath))
    for (const file of sorted) {
      lines.push(`| ${file.kind} | \`${file.sourcePath ?? file.name}\` | [${file.zipPath}](${markdownTarget(file.zipPath)}) | ${file.bytes} B |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
