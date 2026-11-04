import assert from 'node:assert/strict'
import { rm, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { DEFAULT_CONFIG, normalizeConfig, resolveOutputDir } from '../lib/config.js'
import { tempDir } from './helpers.mjs'

test('defaults are stable and frozen', () => {
  const config = normalizeConfig({})
  assert.equal(config.includeWorkspace, 'auto')
  assert.equal(config.includeAttachments, true)
  assert.equal(config.includeRawLog, true)
  assert.equal(config.includeReasoning, false)
  assert.equal(config.maxTotalBytes, DEFAULT_CONFIG.maxTotalBytes)
  assert.ok(Object.isFrozen(config))
})

test('accepts documented overrides', () => {
  const config = normalizeConfig({
    outputDir: 'D:/exports',
    includeWorkspace: 'always',
    includeAttachments: false,
    includeRawLog: false,
    includeReasoning: true,
    maxToolChars: 1000,
    maxMessageChars: 3000,
  })
  assert.equal(config.outputDir, 'D:/exports')
  assert.equal(config.includeWorkspace, 'always')
  assert.equal(config.includeAttachments, false)
  assert.equal(config.includeRawLog, false)
  assert.equal(config.includeReasoning, true)
  assert.equal(config.maxToolChars, 1000)
})

test('rejects invalid values instead of silently changing behavior', () => {
  assert.throws(() => normalizeConfig({ includeWorkspace: 'sometimes' }), /includeWorkspace/)
  assert.throws(() => normalizeConfig({ includeAttachments: 'yes' }), /includeAttachments/)
  assert.throws(() => normalizeConfig({ maxToolChars: 1 }), /maxToolChars/)
  assert.throws(() => normalizeConfig({ ignoreNames: ['ok', ''] }), /ignoreNames/)
})

test('resolveOutputDir creates the configured directory', async () => {
  const root = await tempDir()
  try {
    const target = path.join(root, 'nested', 'exports')
    const resolved = await resolveOutputDir(normalizeConfig({ outputDir: target }))
    assert.equal(resolved, path.resolve(target))
    assert.equal((await stat(resolved)).isDirectory(), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resolveOutputDir defaults outside the project', async () => {
  const resolved = await resolveOutputDir(normalizeConfig({}))
  assert.ok(path.isAbsolute(resolved))
  assert.ok(resolved.includes('DSH-Exports'))
})
