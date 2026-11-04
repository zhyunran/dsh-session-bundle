/**
 * Collect every file a bundle should carry:
 *
 *   1. attachments declared by the session's messages (user uploads, peer files);
 *   2. files the session declared with `present` (deliverables/presented);
 *   3. files written/edited by explicit file tools (write / edit / str_replace_editor);
 *   4. files changed during the session, from `workspace/changes` summaries when
 *      the Host still holds them (git worktree diffs + captured file-tool edits);
 *   5. an optional modified-file scan of the working directory for shell output
 *      that no summary covers.
 *
 * Every candidate is deduplicated by absolute path, size-capped, hashed, and
 * assigned a stable archive path.
 *
 * @module dsh-session-bundle/collect
 */

import { lstat, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { contentOfEvent } from './session.js'
import { formatBytes, safeName, safeRelativePath, sha256, uniqueEntryName } from './util.js'

const MAX_SCANNED_ENTRIES = 20000
const MAX_SCAN_DEPTH = 24

function toPosix (value) {
  return value.split(path.sep).join('/')
}

function isInside (parent, child) {
  const relative = path.relative(parent, child)
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function pathKey (value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function parseArguments (raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
  try {
    const value = JSON.parse(raw)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

function candidatePathsFromTool (name, args) {
  const paths = []
  if (args === undefined) return paths
  const push = (value) => {
    if (typeof value === 'string' && value.trim().length > 0) paths.push(value.trim())
  }
  if (name === 'present' && Array.isArray(args.files)) {
    for (const file of args.files) {
      if (file !== null && typeof file === 'object') push(file.path)
    }
    return paths
  }
  if (name === 'write' || name === 'edit' || name === 'str_replace_editor') {
    push(args.file_path)
    push(args.path)
  }
  return paths
}

async function loadAttachmentBytes (ctx, ref, config, signal) {
  const store = ctx.get('attachments')
  if (store === undefined || store === null) return { error: 'attachment service is not mounted' }
  const call = (method, ...args) => {
    try {
      return typeof store[method] === 'function' ? store[method](...args) : undefined
    } catch {
      return undefined
    }
  }
  const image = typeof ref.mediaType === 'string'
  let hostPath = image
    ? (call('imageHostPath', ref) ?? call('fileHostPath', ref))
    : (call('fileHostPath', ref) ?? call('imageHostPath', ref))
  if (typeof hostPath === 'string' && hostPath.length > 0) {
    try {
      const info = await stat(hostPath)
      if (info.size > config.maxFileBytes) return { error: `larger than ${formatBytes(config.maxFileBytes)}` }
      return { data: await readFile(hostPath, { signal }) }
    } catch {
      /* fall through to the service reads */
    }
  }
  if (image) {
    try {
      const stored = await store.readImage?.(ref, signal)
      const raw = stored?.data ?? stored
      if (raw !== undefined) {
        const data = typeof raw === 'string' ? Buffer.from(raw, 'base64') : Buffer.from(raw)
        if (data.length > config.maxFileBytes) return { error: `larger than ${formatBytes(config.maxFileBytes)}` }
        return { data }
      }
    } catch {
      /* fall through */
    }
  }
  if (typeof store.readFileStream === 'function') {
    try {
      const chunks = []
      let total = 0
      for await (const chunk of store.readFileStream(ref, signal)) {
        const buffer = Buffer.from(chunk)
        total += buffer.length
        if (total > config.maxFileBytes) return { error: `larger than ${formatBytes(config.maxFileBytes)}` }
        chunks.push(buffer)
      }
      return { data: Buffer.concat(chunks) }
    } catch {
      /* fall through */
    }
  }
  return { error: 'attachment bytes are unavailable from this backend' }
}

/**
 * Collect all bundle files.
 *
 * @param {{ ctx: any, config: Readonly<Record<string, any>>, session: any, events: ReadonlyArray<Record<string, any>>, signal?: AbortSignal }} input
 * @returns {Promise<{
 *   files: Array<Record<string, any>>,
 *   attachments: Array<Record<string, any>>,
 *   changes: Array<Record<string, any>>,
 *   skipped: Array<{ path: string, reason: string }>,
 *   attachmentPaths: Map<string, string>,
 *   stats: Record<string, number>,
 * }>}
 */
export async function collectFiles ({ ctx, config, session, events, signal }) {
  const header = session.header ?? {}
  const cwd = typeof header.cwd === 'string' ? path.resolve(header.cwd) : undefined
  const createdAt = typeof header.createdAt === 'number' ? header.createdAt : undefined
  const files = []
  const skipped = []
  const skippedKeys = new Set()
  const usedZipNames = new Set()
  const byAbsolute = new Map()
  const attachmentPaths = new Map()
  const attachments = []
  const changes = []
  let totalBytes = 0
  let workspaceBytes = 0
  const stats = { attachments: 0, produced: 0, workspaceChanged: 0, workspaceScanned: 0, scannedSkipped: 0 }

  const skip = (sourcePath, reason) => {
    const key = `${pathKey(sourcePath)}\u0000${reason}`
    if (skippedKeys.has(key)) return
    skippedKeys.add(key)
    skipped.push({ path: sourcePath, reason })
  }

  const zipPathFor = (sourcePath, kind) => {
    if (kind === 'workspace-changed' || kind === 'workspace-scan') {
      if (cwd !== undefined && isInside(cwd, sourcePath)) {
        return `workspace/${safeRelativePath(path.relative(cwd, sourcePath))}`
      }
      return `files/external/${safeName(path.basename(sourcePath), 'file')}`
    }
    if (kind === 'produced') {
      // Preserve workspace-relative paths so two plugins with the same
      // basename do not collapse into `config-2.js` and friends.
      if (cwd !== undefined && isInside(cwd, sourcePath)) {
        return `files/produced/${safeRelativePath(path.relative(cwd, sourcePath))}`
      }
      return `files/produced/_external/${safeName(path.basename(sourcePath), 'file')}`
    }
    return `files/${safeName(path.basename(sourcePath), 'file')}`
  }

  const addPath = async (sourcePath, kind, meta = {}) => {
    if (typeof sourcePath !== 'string' || sourcePath.trim().length === 0) return undefined
    // Tool/present paths are documented as relative to the Session working
    // directory, not to whatever cwd the Host process happens to have.
    const absolute = path.isAbsolute(sourcePath)
      ? path.resolve(sourcePath)
      : path.resolve(cwd ?? process.cwd(), sourcePath)
    const key = pathKey(absolute)
    const existing = byAbsolute.get(key)
    if (existing !== undefined) {
      existing.meta = { ...existing.meta, ...meta }
      return existing
    }
    signal?.throwIfAborted()
    let info
    try {
      info = await stat(absolute)
    } catch {
      skip(absolute, 'missing (deleted or moved)')
      return undefined
    }
    if (!info.isFile()) {
      skip(absolute, 'not a regular file')
      return undefined
    }
    if (info.size > config.maxFileBytes) {
      skip(absolute, `larger than ${formatBytes(config.maxFileBytes)}`)
      return undefined
    }
    const workspaceKind = kind === 'workspace-changed' || kind === 'workspace-scan'
    const budget = workspaceKind ? config.maxWorkspaceBytes : config.maxTotalBytes
    const used = workspaceKind ? workspaceBytes : totalBytes
    if (used + info.size > budget || totalBytes + info.size > config.maxTotalBytes) {
      skip(absolute, `total budget reached (${formatBytes(budget)})`)
      return undefined
    }
    let data
    try {
      data = await readFile(absolute, { signal })
    } catch {
      skip(absolute, 'unreadable')
      return undefined
    }
    const zipPath = uniqueEntryName(usedZipNames, zipPathFor(absolute, kind))
    const record = {
      zipPath,
      data,
      kind,
      sourcePath: absolute,
      name: path.basename(absolute),
      bytes: data.length,
      sha256: sha256(data),
      mtime: info.mtimeMs,
      meta,
    }
    byAbsolute.set(key, record)
    files.push(record)
    totalBytes += record.bytes
    if (workspaceKind) workspaceBytes += record.bytes
    if (kind === 'attachment') stats.attachments += 1
    else if (kind === 'produced') stats.produced += 1
    else if (kind === 'workspace-changed') stats.workspaceChanged += 1
    else if (kind === 'workspace-scan') stats.workspaceScanned += 1
    return record
  }

  // 1. Attachments declared by the session's content blocks.
  if (config.includeAttachments) {
    const seen = new Set()
    for (const event of events) {
      for (const block of contentOfEvent(event)) {
        if (block === null || typeof block !== 'object') continue
        if (block.type !== 'file' && block.type !== 'image') continue
        const ref = block.attachment
        if (ref === null || typeof ref !== 'object' || typeof ref.attachmentId !== 'string') continue
        const attachmentId = ref.attachmentId
        if (seen.has(attachmentId)) continue
        seen.add(attachmentId)
        const loaded = await loadAttachmentBytes(ctx, ref, config, signal)
        if (loaded.error !== undefined) {
          skip(`attachment:${attachmentId}`, loaded.error)
          continue
        }
        const name = typeof ref.name === 'string' && ref.name.trim().length > 0
          ? ref.name.trim()
          : `${attachmentId.replace(/^sha256:/u, '').slice(0, 16)}${block.type === 'image' ? '.bin' : ''}`
        const data = Buffer.from(loaded.data)
        if (totalBytes + data.length > config.maxTotalBytes) {
          skip(`attachment:${attachmentId}`, `total budget reached (${formatBytes(config.maxTotalBytes)})`)
          continue
        }
        const zipPath = uniqueEntryName(usedZipNames, `files/attachments/${safeName(name, 'attachment')}`)
        const record = {
          zipPath,
          data,
          kind: 'attachment',
          sourcePath: undefined,
          name,
          bytes: data.length,
          sha256: sha256(data),
          mtime: typeof event.time === 'number' ? event.time : undefined,
          meta: { attachmentId },
        }
        files.push(record)
        attachments.push({ attachmentId, name, zipPath, bytes: data.length })
        attachmentPaths.set(attachmentId, zipPath)
        totalBytes += data.length
        stats.attachments += 1
      }
    }
  }

  // 2. Present declarations: the canonical durable event, with the tool call as
  //    a fallback for logs written before that event existed.
  const presentedPaths = new Set()
  for (const event of events) {
    if (event.type === 'deliverables/presented' && Array.isArray(event.data?.files)) {
      for (const file of event.data.files) {
        if (file === null || typeof file !== 'object' || typeof file.path !== 'string') continue
        presentedPaths.add(file.path)
        await addPath(file.path, 'produced', {
          turn: event.data.turn,
          description: typeof file.description === 'string' ? file.description : undefined,
          origin: 'present',
        })
      }
    }
  }

  // 3. File-tool writes and explicit present calls.
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const name = typeof event.data?.name === 'string' ? event.data.name : ''
    const args = parseArguments(event.data?.arguments)
    if (args === undefined) continue
    for (const candidate of candidatePathsFromTool(name, args)) {
      if (name === 'present') presentedPaths.add(candidate)
      await addPath(candidate, 'produced', {
        turn: event.data?.turn,
        step: event.data?.step,
        tool: name,
        origin: name,
      })
    }
  }

  // 4. Workspace-change summaries (authoritative while the Host holds them).
  const workspaceChanges = ctx.get('workspaceChanges')
  const hasWorkspaceService = workspaceChanges !== undefined && workspaceChanges !== null && typeof workspaceChanges.summary === 'function'
  let summaryCount = 0
  if (hasWorkspaceService && config.includeWorkspace !== 'never') {
    for (const event of events) {
      if (event.type !== 'workspace/changes') continue
      let summary
      try {
        summary = workspaceChanges.summary(session.id, event.seq)
      } catch {
        summary = undefined
      }
      if (summary === undefined || summary === null) continue
      summaryCount += 1
      const summaryCwd = typeof summary.cwd === 'string' ? path.resolve(summary.cwd) : cwd
      const listed = []
      for (const file of Array.isArray(summary.files) ? summary.files : []) {
        if (file === null || typeof file !== 'object' || typeof file.path !== 'string') continue
        const absolute = path.isAbsolute(file.path)
          ? file.path
          : path.resolve(summaryCwd ?? process.cwd(), file.path)
        const record = await addPath(absolute, 'workspace-changed', {
          turn: summary.turn,
          display: file.display,
          added: file.added,
          deleted: file.deleted,
          origin: 'workspace-changes',
        })
        listed.push({
          path: file.path,
          display: file.display,
          added: file.added,
          deleted: file.deleted,
          zipPath: record?.zipPath,
        })
      }
      changes.push({
        turn: summary.turn,
        total: summary.total,
        listed: listed.length,
        added: summary.added,
        deleted: summary.deleted,
        files: listed,
      })
    }
  }

  // 5. Modified-file scan when no summaries cover the session (or always).
  const shouldScan = config.includeWorkspace === 'always' || (config.includeWorkspace === 'auto' && summaryCount === 0)
  if (shouldScan && cwd !== undefined && config.includeWorkspace !== 'never') {
    const started = createdAt ?? 0
    let entries = 0
    const ignored = new Set(config.ignoreNames.map((name) => name.toLowerCase()))
    const walk = async (dir, depth) => {
      if (depth > MAX_SCAN_DEPTH || entries > MAX_SCANNED_ENTRIES) return
      let listing
      try {
        listing = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of listing) {
        if (entries > MAX_SCANNED_ENTRIES) return
        entries += 1
        const absolute = path.join(dir, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          if (ignored.has(entry.name.toLowerCase())) continue
          await walk(absolute, depth + 1)
          continue
        }
        if (!entry.isFile()) continue
        if (ignored.has(entry.name.toLowerCase())) continue
        try {
          const info = await lstat(absolute)
          if (started > 0 && info.mtimeMs + 2000 < started) continue
        } catch {
          continue
        }
        await addPath(absolute, 'workspace-scan', { origin: 'workspace-scan' })
      }
    }
    await walk(cwd, 0)
    if (entries > MAX_SCANNED_ENTRIES) stats.scannedSkipped = 1
  }

  return { files, attachments, changes, skipped, attachmentPaths, stats: { ...stats, totalBytes, summaryCount } }
}
