/**
 * Minimal, dependency-free ZIP writer (STORE method).
 *
 * STORE is deliberate: the bundle contains images and Office files that are
 * already compressed, and a readable transcript plus JSONL do not justify a
 * deflate implementation or a vendored dependency. Every entry carries a real
 * CRC-32, UTF-8 names (flag bit 11), and a correct central directory, so both
 * Explorer/Expand-Archive and any standard unzip tool accept it.
 *
 * @module dsh-session-bundle/zip
 */

import { open } from 'node:fs/promises'

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50
const UTF8_FLAG = 0x0800
const VERSION = 20

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

/** CRC-32 of one buffer. */
export function crc32 (buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Convert epoch milliseconds to the DOS date/time pair ZIP stores. */
function dosDateTime (value) {
  const date = new Date(typeof value === 'number' && Number.isFinite(value) ? value : Date.now())
  const year = Math.min(2107, Math.max(1980, date.getFullYear()))
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

/**
 * Normalize one archive name: forward slashes, no absolute prefix, no `..`
 * segment, no control characters, no trailing slash.
 */
export function safeZipName (name) {
  const raw = String(name ?? '').replace(/\\/gu, '/')
  const segments = []
  for (const segment of raw.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..') continue
    const cleaned = segment
      .replace(/[\u0000-\u001f\u007f]/gu, '')
      .replace(/^[ .]+|[ .]+$/gu, '')
    if (cleaned.length === 0) continue
    segments.push(cleaned)
  }
  return segments.join('/')
}

/**
 * Write one STORE-only ZIP file.
 *
 * @param {string} filePath destination path (created/truncated).
 * @param {Array<{ name: string, data: Buffer | Uint8Array, mtime?: number }>} entries
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ entries: number, bytes: number }>}
 */
export async function writeZip (filePath, entries, { signal } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('zip: at least one entry is required')
  if (entries.length > 0xffff) throw new Error('zip: too many entries for the non-ZIP64 writer')
  const handle = await open(filePath, 'w')
  const central = []
  let offset = 0
  try {
    for (const entry of entries) {
      signal?.throwIfAborted()
      const name = safeZipName(entry.name)
      if (name.length === 0) throw new Error('zip: entry name is empty after normalization')
      const nameBuffer = Buffer.from(name, 'utf8')
      const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
      const crc = crc32(data)
      const { time, day } = dosDateTime(entry.mtime)
      const localOffset = offset

      const header = Buffer.alloc(30)
      header.writeUInt32LE(LOCAL_SIGNATURE, 0)
      header.writeUInt16LE(VERSION, 4)
      header.writeUInt16LE(UTF8_FLAG, 6)
      header.writeUInt16LE(0, 8)
      header.writeUInt16LE(time, 10)
      header.writeUInt16LE(day, 12)
      header.writeUInt32LE(crc, 14)
      header.writeUInt32LE(data.length, 18)
      header.writeUInt32LE(data.length, 22)
      header.writeUInt16LE(nameBuffer.length, 26)
      header.writeUInt16LE(0, 28)

      await handle.write(header, 0, header.length, offset)
      offset += header.length
      await handle.write(nameBuffer, 0, nameBuffer.length, offset)
      offset += nameBuffer.length
      if (data.length > 0) {
        await handle.write(data, 0, data.length, offset)
        offset += data.length
      }

      central.push({ nameBuffer, crc, size: data.length, time, day, localOffset })
    }

    const centralStart = offset
    for (const entry of central) {
      signal?.throwIfAborted()
      const header = Buffer.alloc(46)
      header.writeUInt32LE(CENTRAL_SIGNATURE, 0)
      header.writeUInt16LE(VERSION, 4)
      header.writeUInt16LE(VERSION, 6)
      header.writeUInt16LE(UTF8_FLAG, 8)
      header.writeUInt16LE(0, 10)
      header.writeUInt16LE(entry.time, 12)
      header.writeUInt16LE(entry.day, 14)
      header.writeUInt32LE(entry.crc, 16)
      header.writeUInt32LE(entry.size, 20)
      header.writeUInt32LE(entry.size, 24)
      header.writeUInt16LE(entry.nameBuffer.length, 28)
      header.writeUInt16LE(0, 30)
      header.writeUInt16LE(0, 32)
      header.writeUInt16LE(0, 34)
      header.writeUInt16LE(0, 36)
      header.writeUInt32LE(0, 38)
      header.writeUInt32LE(entry.localOffset, 42)
      await handle.write(header, 0, header.length, offset)
      offset += header.length
      await handle.write(entry.nameBuffer, 0, entry.nameBuffer.length, offset)
      offset += entry.nameBuffer.length
    }

    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(EOCD_SIGNATURE, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(central.length, 8)
    eocd.writeUInt16LE(central.length, 10)
    eocd.writeUInt32LE(offset - centralStart, 12)
    eocd.writeUInt32LE(centralStart, 16)
    eocd.writeUInt16LE(0, 20)
    await handle.write(eocd, 0, eocd.length, offset)
    offset += eocd.length
    await handle.sync()
    return { entries: central.length, bytes: offset }
  } finally {
    await handle.close()
  }
}
