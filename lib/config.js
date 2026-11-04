/**
 * Configuration and output-location policy for the session bundle exporter.
 *
 * @module dsh-session-bundle/config
 */

import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expandHome } from './util.js'

export const DEFAULT_IGNORED_NAMES = Object.freeze([
  '.git',
  '.hg',
  '.svn',
  '.pnpm',
  '.pnpm-store',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.turbo',
  '.cache',
  '.idea',
  '.DS_Store',
  'Thumbs.db',
])

export const DEFAULT_CONFIG = Object.freeze({
  /** `''` means: Desktop/DSH-Exports when available, else <home>/DSH-Exports. */
  outputDir: '',
  /** `auto` = use workspace/changes when available, else a modified-file scan. */
  includeWorkspace: 'auto',
  includeAttachments: true,
  includeRawLog: true,
  includeReasoning: false,
  includeInjectedContext: false,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 300 * 1024 * 1024,
  maxWorkspaceFiles: 300,
  maxWorkspaceBytes: 200 * 1024 * 1024,
  maxToolChars: 4000,
  maxMessageChars: 20000,
  maxRawLogBytes: 50 * 1024 * 1024,
  ignoreNames: [...DEFAULT_IGNORED_NAMES],
})

const WORKSPACE_MODES = new Set(['auto', 'always', 'never'])

function numberField (source, key, fallback, min, max) {
  const raw = source[key]
  if (raw === undefined) return fallback
  const value = typeof raw === 'string' ? Number(raw.trim()) : raw
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`dsh-session-bundle config.${key} must be an integer between ${min} and ${max}`)
  }
  return value
}

function booleanField (source, key, fallback) {
  const raw = source[key]
  if (raw === undefined) return fallback
  if (typeof raw !== 'boolean') throw new Error(`dsh-session-bundle config.${key} must be true or false`)
  return raw
}

function stringListField (source, key, fallback) {
  const raw = source[key]
  if (raw === undefined) return [...fallback]
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    throw new Error(`dsh-session-bundle config.${key} must be an array of non-empty strings`)
  }
  return raw.map((entry) => entry.trim())
}

/** Validate the plugin config block. */
export function normalizeConfig (raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const includeWorkspace = source.includeWorkspace === undefined ? DEFAULT_CONFIG.includeWorkspace : String(source.includeWorkspace).trim()
  if (!WORKSPACE_MODES.has(includeWorkspace)) {
    throw new Error('dsh-session-bundle config.includeWorkspace must be one of: auto, always, never')
  }
  const outputDir = source.outputDir === undefined ? '' : String(source.outputDir).trim()
  const effective = {
    outputDir,
    includeWorkspace,
    includeAttachments: booleanField(source, 'includeAttachments', DEFAULT_CONFIG.includeAttachments),
    includeRawLog: booleanField(source, 'includeRawLog', DEFAULT_CONFIG.includeRawLog),
    includeReasoning: booleanField(source, 'includeReasoning', DEFAULT_CONFIG.includeReasoning),
    includeInjectedContext: booleanField(source, 'includeInjectedContext', DEFAULT_CONFIG.includeInjectedContext),
    maxFileBytes: numberField(source, 'maxFileBytes', DEFAULT_CONFIG.maxFileBytes, 1, 2 * 1024 * 1024 * 1024),
    maxTotalBytes: numberField(source, 'maxTotalBytes', DEFAULT_CONFIG.maxTotalBytes, 1024, 4 * 1024 * 1024 * 1024),
    maxWorkspaceFiles: numberField(source, 'maxWorkspaceFiles', DEFAULT_CONFIG.maxWorkspaceFiles, 1, 5000),
    maxWorkspaceBytes: numberField(source, 'maxWorkspaceBytes', DEFAULT_CONFIG.maxWorkspaceBytes, 1024, 4 * 1024 * 1024 * 1024),
    maxToolChars: numberField(source, 'maxToolChars', DEFAULT_CONFIG.maxToolChars, 200, 200000),
    maxMessageChars: numberField(source, 'maxMessageChars', DEFAULT_CONFIG.maxMessageChars, 200, 2000000),
    maxRawLogBytes: numberField(source, 'maxRawLogBytes', DEFAULT_CONFIG.maxRawLogBytes, 1024, 1024 * 1024 * 1024),
    ignoreNames: stringListField(source, 'ignoreNames', DEFAULT_CONFIG.ignoreNames),
  }
  if (effective.maxWorkspaceBytes > effective.maxTotalBytes) effective.maxWorkspaceBytes = effective.maxTotalBytes
  return Object.freeze(effective)
}

function desktopCandidates () {
  const home = os.homedir()
  const candidates = []
  if (process.platform === 'win32' && typeof process.env.USERPROFILE === 'string') {
    candidates.push(path.join(process.env.USERPROFILE, 'Desktop'))
  }
  if (typeof process.env.XDG_DESKTOP_DIR === 'string') candidates.push(process.env.XDG_DESKTOP_DIR)
  candidates.push(path.join(home, 'Desktop'))
  return candidates
}

/**
 * Resolve and create the directory a bundle is written to.
 *
 * @param {Readonly<Record<string, any>>} config effective config.
 * @returns {Promise<string>} absolute output directory.
 */
export async function resolveOutputDir (config) {
  const home = os.homedir()
  let directory
  if (typeof config.outputDir === 'string' && config.outputDir.length > 0) {
    directory = path.resolve(expandHome(config.outputDir, home))
  } else {
    const desktop = desktopCandidates().find((candidate) => candidate.length > 0)
    directory = path.join(desktop ?? home, 'DSH-Exports')
  }
  await mkdir(directory, { recursive: true })
  return directory
}
