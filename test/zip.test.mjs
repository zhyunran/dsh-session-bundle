import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { crc32, safeZipName, writeZip } from '../lib/zip.js'
import { readZipEntries, tempDir } from './helpers.mjs'

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('hello')), 0x3610a686)
  assert.equal(crc32(Buffer.alloc(0)), 0)
})

test('safeZipName removes traversal, absolute prefixes and control characters', () => {
  assert.equal(safeZipName('../../evil.txt'), 'evil.txt')
  assert.equal(safeZipName('/abs/path.txt'), 'abs/path.txt')
  assert.equal(safeZipName('a\\b\\c.txt'), 'a/b/c.txt')
  assert.equal(safeZipName('a/\u0000bad.txt'), 'a/bad.txt')
})

test('writeZip produces a readable STORE archive with UTF-8 names and bytes', async () => {
  const dir = await tempDir()
  try {
    const file = path.join(dir, 'bundle.zip')
    const payload = Buffer.from([0, 1, 2, 3, 250, 251, 252])
    const result = await writeZip(file, [
      { name: 'hello.txt', data: Buffer.from('hello 世界\n', 'utf8') },
      { name: 'dir/binary.bin', data: payload },
      { name: 'empty.txt', data: Buffer.alloc(0) },
    ])
    assert.equal(result.entries, 3)
    const raw = await readFile(file)
    assert.equal(raw.length, result.bytes)
    const entries = readZipEntries(raw)
    assert.deepEqual([...entries.keys()], ['hello.txt', 'dir/binary.bin', 'empty.txt'])
    assert.equal(entries.get('hello.txt').data.toString('utf8'), 'hello 世界\n')
    assert.deepEqual([...entries.get('dir/binary.bin').data], [...payload])
    assert.equal(entries.get('empty.txt').size, 0)
    for (const entry of entries.values()) {
      assert.equal(entry.method, 0)
      assert.equal(entry.crc, crc32(entry.data))
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('writeZip refuses duplicate empty names after normalization', async () => {
  const dir = await tempDir()
  try {
    await assert.rejects(writeZip(path.join(dir, 'x.zip'), [{ name: '../', data: Buffer.from('x') }]), /empty/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
