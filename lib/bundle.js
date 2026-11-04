/**
 * Orchestrate one session export: snapshot → collect → render → ZIP.
 *
 * @module dsh-session-bundle/bundle
 */

import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { collectFiles } from './collect.js'
import { resolveOutputDir } from './config.js'
import { renderConversation } from './markdown.js'
import { sessionMeta, snapshotSession } from './session.js'
import { eventsToJsonl, formatBytes, isoTime, safeName } from './util.js'
import { writeZip } from './zip.js'

const FORMAT = 'dsh-session-bundle/v1'

function stamp (date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

async function uniqueZipPath (outputDir, base) {
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? '' : `-${index}`
    const candidate = path.join(outputDir, `${base}${suffix}.zip`)
    try {
      await stat(candidate)
    } catch {
      return candidate
    }
  }
  throw new Error('could not find a free bundle filename')
}

function renderReadme ({ meta, outputDir, zipPath, generatedAt }) {
  return [
    'DSH session bundle',
    '==================',
    '',
    `Session:  ${meta.title || '(untitled)'}`,
    `Id:       ${meta.id}`,
    ...(meta.cwd === undefined ? [] : [`Cwd:      ${meta.cwd}`]),
    ...(meta.createdAt === undefined ? [] : [`Created:  ${isoTime(meta.createdAt)}`]),
    `Exported: ${isoTime(generatedAt)}`,
    '',
    'Contents',
    '--------',
    'conversation.md     readable transcript (user/assistant text, tool calls/results)',
    'session.v4.jsonl    raw durable session event log (JSON Lines)',
    'manifest.json       machine-readable file index and counts',
    'files/              attachments and explicit deliverables/produced files',
    'workspace/          copies of files the session changed in its working directory',
    '',
    'Notes',
    '-----',
    '- Files are copied as they exist at export time. Deleted files are listed in',
    '  manifest.json under "files" (with no bytes) or "skipped".',
    '- conversation.md omits system prompts, developer messages and reasoning by',
    '  default; session.v4.jsonl remains the raw source of truth.',
    '- workspace/ uses the workspace/changes summaries when the Host still holds',
    '  them; otherwise it falls back to a modified-since-session-start scan.',
    '',
    `Archive: ${zipPath}`,
    `Output dir: ${outputDir}`,
    '',
  ].join('\n')
}

/**
 * Export one live session.
 *
 * @param {{
 *   ctx: any,
 *   config: Readonly<Record<string, any>>,
 *   session: any,
 *   signal?: AbortSignal,
 *   source: 'command' | 'tool',
 * }} input
 * @returns {Promise<Record<string, any>>}
 */
export async function exportSessionBundle ({ ctx, config, session, signal, source }) {
  const events = await snapshotSession(ctx, session)
  const meta = sessionMeta(session, events)
  const title = meta.title.length > 0 ? meta.title : (meta.id.length > 0 ? meta.id : 'session')
  meta.title = title
  const generatedAt = Date.now()
  const collected = await collectFiles({ ctx, config, session, events, signal })

  const conversation = renderConversation({
    session,
    events,
    meta,
    files: collected.files,
    attachmentPaths: collected.attachmentPaths,
    changes: collected.changes,
    options: config,
    generatedAt,
    source,
  })

  const extraSkipped = [...collected.skipped]
  let rawLog
  if (config.includeRawLog) {
    const jsonl = eventsToJsonl(events)
    if (Buffer.byteLength(jsonl) > config.maxRawLogBytes) {
      extraSkipped.push({ path: 'session.v4.jsonl', reason: `larger than ${formatBytes(config.maxRawLogBytes)}` })
    } else {
      rawLog = jsonl
    }
  }

  const fileIndex = collected.files.map((file) => ({
    zipPath: file.zipPath,
    kind: file.kind,
    name: file.name,
    ...(file.sourcePath === undefined ? {} : { sourcePath: file.sourcePath }),
    bytes: file.bytes,
    sha256: file.sha256,
    ...(file.mtime === undefined ? {} : { mtime: file.mtime }),
    ...(file.meta === undefined ? {} : { meta: file.meta }),
  }))

  const manifest = {
    format: FORMAT,
    exportedAt: new Date(generatedAt).toISOString(),
    source,
    session: meta,
    counts: {
      files: collected.files.length,
      attachments: collected.attachments.length,
      produced: collected.files.filter((file) => file.kind === 'produced').length,
      workspaceChanged: collected.files.filter((file) => file.kind === 'workspace-changed').length,
      workspaceScanned: collected.files.filter((file) => file.kind === 'workspace-scan').length,
      changes: collected.changes.length,
      bytes: collected.stats.totalBytes,
    },
    options: {
      includeWorkspace: config.includeWorkspace,
      includeAttachments: config.includeAttachments,
      includeRawLog: config.includeRawLog,
      includeReasoning: config.includeReasoning,
      includeInjectedContext: config.includeInjectedContext,
      maxFileBytes: config.maxFileBytes,
      maxTotalBytes: config.maxTotalBytes,
    },
    files: fileIndex,
    changes: collected.changes,
    skipped: extraSkipped,
  }

  const outputDir = await resolveOutputDir(config)
  await mkdir(outputDir, { recursive: true })
  const base = `DSH-${safeName(title, 'session')}-${stamp(new Date(generatedAt))}`
  const zipPath = await uniqueZipPath(outputDir, base)
  const temporary = `${zipPath}.${process.pid}.tmp`

  const entries = []
  entries.push({ name: 'README.txt', data: Buffer.from(renderReadme({ meta, outputDir, zipPath, generatedAt }), 'utf8'), mtime: generatedAt })
  entries.push({ name: 'conversation.md', data: Buffer.from(conversation, 'utf8'), mtime: generatedAt })
  if (rawLog !== undefined) entries.push({ name: 'session.v4.jsonl', data: Buffer.from(rawLog, 'utf8'), mtime: generatedAt })
  entries.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), mtime: generatedAt })
  for (const file of collected.files) entries.push({ name: file.zipPath, data: file.data, mtime: file.mtime ?? generatedAt })

  try {
    const written = await writeZip(temporary, entries, { signal })
    await rename(temporary, zipPath)
    const info = await stat(zipPath)
    return {
      zipPath,
      outputDir,
      bytes: info.size,
      entries: written.entries,
      title,
      session: meta,
      counts: manifest.counts,
      changes: collected.changes,
      skipped: extraSkipped,
      generatedAt,
    }
  } catch (error) {
    try {
      await unlink(temporary)
    } catch {
      /* best effort */
    }
    throw error
  }
}
