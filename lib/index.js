/**
 * dsh-session-bundle — one-command export of a DSH conversation plus the files
 * that session actually produced.
 *
 * What core DSH already does:
 *   `/export` (and the Session-header "download session log" menu item) streams
 *   a ZIP of the raw session log and every attachment referenced by its events.
 * What it does not do:
 *   render a readable transcript, or copy the files the session wrote/edited/
 *   presented/changed in its working directory.
 * This plugin adds that second layer and keeps the raw log too.
 *
 * Interfaces:
 *   `/bundle` — human slash command; writes to Desktop/DSH-Exports.
 *   `export_session_bundle` — the same export callable by an agent.
 *
 * @module dsh-session-bundle
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createCommandHandler } from './command.js'
import { normalizeConfig } from './config.js'
import { createExportTool } from './tool.js'

export const name = 'dsh-session-bundle'

/** Commands power `/bundle`; tools power the model-facing export call. */
export const inject = ['commands', 'tools']

function log (ctx, level, message) {
  try {
    ctx.logger?.[level]?.(`dsh-session-bundle: ${message}`)
  } catch {
    /* logging must never break plugin load */
  }
}

function errorMessage (error) {
  return error && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error)
}

/**
 * @param {any} ctx plugin context.
 * @param {unknown} rawConfig `config` block from the profile patch.
 */
export function apply (ctx, rawConfig) {
  let config
  try {
    config = normalizeConfig(rawConfig)
  } catch (error) {
    log(ctx, 'error', `invalid configuration, using defaults: ${errorMessage(error)}`)
    config = normalizeConfig({})
  }

  // Human-facing one-click command. `bundle` is preferred; `export-bundle` is
  // the fallback when another plugin already owns the short name.
  try {
    const handler = createCommandHandler({ ctx, config })
    ctx.effect(() => {
      let lastError
      for (const commandName of ['bundle', 'export-bundle']) {
        try {
          return ctx.commands.register({
            name: commandName,
            description: '导出本会话：对话 Markdown + 产出文件 + 附件（ZIP）/ Export this conversation + produced files as a ZIP',
            handler,
          })
        } catch (error) {
          lastError = error
        }
      }
      throw lastError ?? new Error('no command name available')
    }, 'session-bundle: /bundle command')
  } catch (error) {
    log(ctx, 'error', `could not register /bundle: ${errorMessage(error)}`)
  }

  try {
    const tool = createExportTool({ defineTool, ctx, config })
    ctx.tools.register(tool)
  } catch (error) {
    log(ctx, 'error', `could not register export_session_bundle: ${errorMessage(error)}`)
  }

  log(ctx, 'info', `ready (output=${config.outputDir || 'Desktop/DSH-Exports'}, workspace=${config.includeWorkspace})`)
}
