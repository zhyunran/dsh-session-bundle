/**
 * Text rendering for the export tool and `/bundle` command result.
 *
 * @module dsh-session-bundle/render
 */

import { formatBytes } from './util.js'

/** Full result text for the model-facing tool. */
export function renderExport (value) {
  const lines = []
  lines.push(`Bundle exported: "${value.title}" (${value.session.id})`)
  lines.push(`ZIP: ${value.zipPath}`)
  lines.push(`Contents: ${value.counts.files} files · ZIP ${formatBytes(value.bytes)} · ${value.session.messages} messages · ${value.session.toolCalls} tool calls`)
  if (typeof value.counts.bytes === 'number' && value.counts.bytes !== value.bytes) {
    lines.push(`File payload: ${formatBytes(value.counts.bytes)} (plus conversation, raw log and manifest)`)
  }
  const bits = []
  if (value.counts.attachments > 0) bits.push(`${value.counts.attachments} attachments`)
  if (value.counts.produced > 0) bits.push(`${value.counts.produced} produced files`)
  if (value.counts.workspaceChanged > 0) bits.push(`${value.counts.workspaceChanged} changed files`)
  if (value.counts.workspaceScanned > 0) bits.push(`${value.counts.workspaceScanned} scanned files`)
  if (bits.length > 0) lines.push(`Files: ${bits.join(' · ')}`)

  if (Array.isArray(value.changes) && value.changes.length > 0) {
    lines.push('')
    lines.push('Turns with file changes:')
    for (const change of value.changes) {
      lines.push(`- turn ${change.turn}: ${change.listed ?? change.files?.length ?? 0}${typeof change.total === 'number' && change.total > (change.listed ?? 0) ? ` of ${change.total}` : ''} files (+${change.added ?? 0}/-${change.deleted ?? 0})`)
    }
  }

  if (Array.isArray(value.skipped) && value.skipped.length > 0) {
    lines.push('')
    lines.push(`Skipped ${value.skipped.length} item(s) (size limits or missing files):`)
    for (const skip of value.skipped.slice(0, 10)) {
      lines.push(`- ${skip.path}: ${skip.reason}`)
    }
    if (value.skipped.length > 10) lines.push(`- …and ${value.skipped.length - 10} more (see manifest.json)`)
  }

  lines.push('')
  lines.push('The ZIP contains conversation.md, session.v4.jsonl, manifest.json, files/ and workspace/. Share the ZIP; no DSH installation is needed to read it.')
  return lines.join('\n')
}

/** Short text for the human `/bundle` command result. */
export function renderCommand (value) {
  return [
    `已导出 ${value.counts.files} 个文件（ZIP ${formatBytes(value.bytes)}，其中文件内容 ${formatBytes(value.counts.bytes)}）到：`,
    value.zipPath,
    `对话：${value.session.messages} 条消息 / ${value.session.toolCalls} 次工具调用；附件 ${value.counts.attachments}，产出文件 ${value.counts.produced}，变更文件 ${value.counts.workspaceChanged + value.counts.workspaceScanned}。`,
  ].join('\n')
}

/** One-line error text. */
export function renderFailure (error) {
  const message = error && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error)
  return `导出失败：${message}`
}
