import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { normalizeConfig } from '../lib/config.js'
import { createExportTool } from '../lib/tool.js'
import { assistantEvent, defineTool, fakeCtx, fakeSession, readZipEntries, tempDir, titleEvent, turnEnd, turnStart, userEvent } from './helpers.mjs'

function build (outputDir) {
  const events = [
    titleEvent(0, 'Tool 测试'),
    turnStart(1, 1),
    userEvent(2, '导出我'),
    assistantEvent(3, '好的'),
    turnEnd(4, 1),
  ]
  const session = fakeSession({ id: 'session-tool', cwd: outputDir, createdAt: Date.now() - 1000, events })
  const ctx = fakeCtx({})
  const tool = createExportTool({ defineTool, ctx, config: normalizeConfig({ outputDir, includeWorkspace: 'never' }) })
  return { tool, session, ctx }
}

test('tool exports a bundle and renders its result', async () => {
  const root = await tempDir()
  try {
    const { tool, session } = build(root)
    assert.equal(tool.name, 'export_session_bundle')
    const value = await tool.execute({ output_dir: root }, { agent: { session }, signal: undefined })
    assert.ok(value.zipPath.startsWith(path.resolve(root)))
    assert.equal(value.session.id, 'session-tool')
    const entries = readZipEntries(await readFile(value.zipPath))
    assert.ok(entries.has('conversation.md'))
    assert.ok(entries.has('manifest.json'))
    const rendered = tool.output.render({}, value)[0].text
    assert.match(rendered, /Bundle exported/)
    assert.match(rendered, /conversation\.md/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('tool refuses to run without an agent session', async () => {
  const { tool } = build(process.cwd())
  await assert.rejects(tool.execute({}, { agent: undefined, signal: undefined }), /inside an agent session/)
})
