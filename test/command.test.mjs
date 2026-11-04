import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { createCommandHandler } from '../lib/command.js'
import { normalizeConfig } from '../lib/config.js'
import { assistantEvent, fakeCtx, fakeSession, readZipEntries, tempDir, titleEvent, turnEnd, turnStart, userEvent } from './helpers.mjs'

test('/bundle handler exports and returns the path', async () => {
  const root = await tempDir()
  try {
    const events = [
      titleEvent(0, 'Command 测试'),
      turnStart(1, 1),
      userEvent(2, '导出'),
      assistantEvent(3, '完成'),
      turnEnd(4, 1),
    ]
    const session = fakeSession({ id: 'session-command', cwd: root, createdAt: Date.now() - 1000, events })
    const ctx = fakeCtx({})
    const handler = createCommandHandler({ ctx, config: normalizeConfig({ outputDir: root, includeWorkspace: 'never' }) })
    const result = await handler({ agent: { session }, rawInput: '', signal: undefined })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /已导出/)
    const zipPath = result.text.split('\n')[1]
    const entries = readZipEntries(await readFile(zipPath))
    assert.ok(entries.has('conversation.md'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('/bundle rejects arguments and missing sessions', async () => {
  const ctx = fakeCtx({})
  const handler = createCommandHandler({ ctx, config: normalizeConfig({}) })
  const withArgs = await handler({ agent: { session: fakeSession({ cwd: process.cwd(), events: [] }) }, rawInput: 'C:/tmp', signal: undefined })
  assert.equal(withArgs.kind, 'error')
  assert.match(withArgs.text, /用法/)
  const missing = await handler({ agent: {}, rawInput: '', signal: undefined })
  assert.equal(missing.kind, 'error')
  assert.match(missing.text, /会话/)
})
