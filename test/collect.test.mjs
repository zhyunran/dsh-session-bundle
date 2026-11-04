import assert from 'node:assert/strict'
import { mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { normalizeConfig } from '../lib/config.js'
import { collectFiles } from '../lib/collect.js'
import { changesEvent, fakeAttachments, fakeCtx, fakeSession, presentedEvent, tempDir, toolCallEvent, userEvent, writeTempFile } from './helpers.mjs'

test('collects attachments, presented files, tool writes, change summaries and a scan', async () => {
  const root = await tempDir()
  try {
    const cwd = path.join(root, 'workspace')
    const outside = path.join(root, 'outside')
    await mkdir(cwd, { recursive: true })
    await mkdir(outside, { recursive: true })
    const attachmentPath = await writeTempFile(outside, 'attach.txt', 'attachment bytes')
    await writeTempFile(cwd, 'out/result.md', '# result\n')
    await writeTempFile(cwd, 'presented.pdf', '%PDF-fake')
    await writeTempFile(cwd, 'shell-output.bin', Buffer.from([1, 2, 3, 4]))
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeTempFile(cwd, 'scanned.txt', 'shell artifact')

    const ref = { attachmentId: 'sha256:attach', name: 'attach.txt', bytes: 16 }
    const createdAt = Date.now() - 60_000
    const session = fakeSession({ cwd, createdAt, events: [] })
    const events = [
      userEvent(1, 'with attachment', { files: [ref] }),
      toolCallEvent(2, { callId: 'c1', name: 'write', arguments: JSON.stringify({ file_path: 'out/result.md', content: '# result\n' }) }),
      presentedEvent(3, 1, [{ path: 'presented.pdf', description: 'report' }]),
      changesEvent(4, 1),
    ]
    const ctx = fakeCtx({
      workspaceSummary: (sessionId, seq) => seq === 4
        ? {
            turn: 1,
            cwd,
            files: [
              { path: 'shell-output.bin', display: 'shell-output.bin', added: 4, deleted: 0 },
              { path: 'out/result.md', display: 'out/result.md', added: 1, deleted: 0 },
            ],
            total: 2,
            added: 5,
            deleted: 0,
          }
        : undefined,
    })
    ctx.attachments = fakeAttachments(new Map([['sha256:attach', attachmentPath]]))

    const config = normalizeConfig({ includeWorkspace: 'always', maxWorkspaceBytes: 10 * 1024 * 1024 })
    const collected = await collectFiles({ ctx, config, session, events })

    const byName = new Map(collected.files.map((file) => [file.name, file]))
    assert.ok(byName.get('attach.txt'), 'attachment included')
    assert.equal(byName.get('attach.txt').kind, 'attachment')
    assert.equal(byName.get('attach.txt').zipPath, 'files/attachments/attach.txt')
    assert.equal(byName.get('result.md').kind, 'produced')
    assert.equal(byName.get('presented.pdf').kind, 'produced')
    assert.equal(byName.get('shell-output.bin').kind, 'workspace-changed')
    assert.equal(byName.get('scanned.txt').kind, 'workspace-scan')
    assert.equal(collected.attachmentPaths.get('sha256:attach'), 'files/attachments/attach.txt')

    // result.md appears in both the write tool and the change summary: one copy.
    assert.equal(collected.files.filter((file) => file.name === 'result.md').length, 1)
    assert.equal(collected.changes.length, 1)
    assert.equal(collected.changes[0].files.length, 2)
    assert.ok(collected.changes[0].files.find((file) => file.path === 'shell-output.bin').zipPath)

    const stats = collected.stats
    assert.equal(stats.attachments, 1)
    assert.equal(stats.produced, 2)
    assert.equal(stats.workspaceChanged, 1)
    assert.equal(stats.workspaceScanned, 1)
    for (const file of collected.files) {
      if (file.sourcePath === undefined) continue
      const info = await stat(file.sourcePath)
      assert.equal(file.bytes, info.size)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('auto mode skips the modified-file scan when change summaries exist', async () => {
  const root = await tempDir()
  try {
    const cwd = path.join(root, 'workspace')
    await mkdir(cwd, { recursive: true })
    await writeTempFile(cwd, 'shell.txt', 'x')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeTempFile(cwd, 'scanned.txt', 'y')
    const session = fakeSession({ cwd, createdAt: Date.now() - 60_000, events: [] })
    const events = [changesEvent(1, 1)]
    const ctx = fakeCtx({
      workspaceSummary: () => ({ turn: 1, cwd, files: [{ path: 'shell.txt', display: 'shell.txt', added: 1, deleted: 0 }], total: 1, added: 1, deleted: 0 }),
    })
    const config = normalizeConfig({ includeWorkspace: 'auto' })
    const collected = await collectFiles({ ctx, config, session, events })
    assert.ok(collected.files.some((file) => file.name === 'shell.txt'))
    assert.equal(collected.files.some((file) => file.name === 'scanned.txt'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('never mode omits change summaries and scan but keeps explicit files', async () => {
  const root = await tempDir()
  try {
    const cwd = path.join(root, 'workspace')
    await mkdir(cwd, { recursive: true })
    await writeTempFile(cwd, 'presented.pdf', 'x')
    const session = fakeSession({ cwd, createdAt: Date.now() - 60_000, events: [] })
    const events = [presentedEvent(1, 1, [{ path: 'presented.pdf' }]), changesEvent(2, 1)]
    const ctx = fakeCtx({
      workspaceSummary: () => ({ turn: 1, cwd, files: [{ path: 'presented.pdf', display: 'presented.pdf' }], total: 1, added: 1, deleted: 0 }),
    })
    const config = normalizeConfig({ includeWorkspace: 'never' })
    const collected = await collectFiles({ ctx, config, session, events })
    assert.equal(collected.files.length, 1)
    assert.equal(collected.files[0].name, 'presented.pdf')
    assert.equal(collected.changes.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
