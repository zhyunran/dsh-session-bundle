import assert from 'node:assert/strict'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { exportSessionBundle } from '../lib/bundle.js'
import { normalizeConfig } from '../lib/config.js'
import { assistantEvent, changesEvent, fakeAttachments, fakeCtx, fakeSession, presentedEvent, readZipEntries, tempDir, titleEvent, toolCallEvent, turnEnd, turnStart, userEvent, writeTempFile } from './helpers.mjs'

test('exports a complete, readable bundle', async () => {
  const root = await tempDir()
  try {
    const cwd = path.join(root, 'workspace')
    const outputDir = path.join(root, 'exports')
    await mkdir(cwd, { recursive: true })
    const attachmentPath = await writeTempFile(root, 'src/attach.txt', 'attachment bytes')
    await writeTempFile(cwd, 'out/result.md', '# result\n')
    await writeTempFile(cwd, 'shell.txt', 'shell change')

    const ref = { attachmentId: 'sha256:attach', name: 'attach.txt', bytes: 16 }
    const createdAt = Date.now() - 60_000
    const events = [
      titleEvent(0, 'Bundle 测试会话'),
      turnStart(1, 1),
      userEvent(2, '带附件的任务', { files: [ref] }),
      assistantEvent(3, '先写文件。', { toolCalls: [{ id: 'c1', name: 'write', arguments: JSON.stringify({ file_path: 'out/result.md' }) }] }),
      toolCallEvent(4, { callId: 'c1', name: 'write', arguments: JSON.stringify({ file_path: 'out/result.md' }) }),
      { type: 'tool/result', seq: 5, time: 1_700_000_000_005, data: { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1', content: [{ type: 'text', text: 'Wrote out/result.md' }] } } },
      presentedEvent(6, 1, [{ path: 'out/result.md', description: '结果' }]),
      changesEvent(7, 1),
      turnEnd(8, 1),
    ]
    const session = fakeSession({ id: 'session-bundle', cwd, createdAt, events })
    const ctx = fakeCtx({
      workspaceSummary: (sessionId, seq) => seq === 7
        ? { turn: 1, cwd, files: [{ path: 'shell.txt', display: 'shell.txt', added: 5, deleted: 0 }], total: 1, added: 5, deleted: 0 }
        : undefined,
    })
    ctx.attachments = fakeAttachments(new Map([['sha256:attach', attachmentPath]]))
    const config = normalizeConfig({ outputDir, includeWorkspace: 'auto' })

    const result = await exportSessionBundle({ ctx, config, session, signal: undefined, source: 'tool' })
    assert.ok(result.zipPath.startsWith(outputDir))
    assert.equal(result.title, 'Bundle 测试会话')
    assert.equal(result.session.id, 'session-bundle')
    assert.ok((await stat(result.zipPath)).size > 0)
    assert.equal(result.counts.attachments, 1)
    assert.equal(result.counts.produced, 1)
    assert.equal(result.counts.workspaceChanged, 1)

    const entries = readZipEntries(await readFile(result.zipPath))
    const names = [...entries.keys()]
    assert.ok(names.includes('README.txt'))
    assert.ok(names.includes('conversation.md'))
    assert.ok(names.includes('session.v4.jsonl'))
    assert.ok(names.includes('manifest.json'))
    assert.ok(names.includes('files/attachments/attach.txt'))
    assert.ok(names.includes('files/produced/out/result.md'))
    assert.ok(names.includes('workspace/shell.txt'))

    const markdown = entries.get('conversation.md').data.toString('utf8')
    assert.match(markdown, /^# Bundle 测试会话/m)
    assert.match(markdown, /带附件的任务/)
    assert.match(markdown, /\[attach\.txt\]\(<files\/attachments\/attach\.txt>\)/)
    assert.match(markdown, /shell\.txt/)

    const manifest = JSON.parse(entries.get('manifest.json').data.toString('utf8'))
    assert.equal(manifest.format, 'dsh-session-bundle/v1')
    assert.equal(manifest.session.id, 'session-bundle')
    assert.equal(manifest.counts.files, 3)
    assert.ok(Array.isArray(manifest.files))
    assert.equal(manifest.files.find((file) => file.name === 'attach.txt').kind, 'attachment')

    assert.equal(entries.get('session.v4.jsonl').data.toString('utf8').split('\n').filter(Boolean).length, events.length)
    assert.equal(entries.get('files/attachments/attach.txt').data.toString('utf8'), 'attachment bytes')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('raw log can be disabled and a second export gets a distinct filename', async () => {
  const root = await tempDir()
  try {
    const outputDir = path.join(root, 'exports')
    await mkdir(outputDir, { recursive: true })
    const session = fakeSession({ cwd: root, createdAt: Date.now(), events: [titleEvent(0, 'Same')] })
    const ctx = fakeCtx({})
    const config = normalizeConfig({ outputDir, includeRawLog: false, includeWorkspace: 'never' })
    const first = await exportSessionBundle({ ctx, config, session, source: 'command' })
    const second = await exportSessionBundle({ ctx, config, session, source: 'command' })
    assert.notEqual(first.zipPath, second.zipPath)
    const entries = readZipEntries(await readFile(first.zipPath))
    assert.equal(entries.has('session.v4.jsonl'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
