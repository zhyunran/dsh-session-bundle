/**
 * Model-facing tool definition for the export.
 *
 * @module dsh-session-bundle/tool
 */

import { exportSessionBundle } from './bundle.js'
import { renderExport } from './render.js'

/**
 * @param {{ defineTool: Function, ctx: any, config: Readonly<Record<string, any>> }} input
 * @returns {Record<string, any>} registry-ready tool definition.
 */
export function createExportTool ({ defineTool, ctx, config }) {
  return defineTool({
    name: 'export_session_bundle',
    description:
      'Export THIS DSH session as a self-contained ZIP on the Host: a human-readable conversation.md, the raw session.v4.jsonl log, ' +
      'manifest.json, every attachment from the conversation, and copies of the files this session produced or changed in its working directory. ' +
      'Use it when the user asks to export / download / archive the conversation together with the files created in it, or wants to hand the work to someone else. ' +
      'The ZIP is written to Desktop\\DSH-Exports by default (configurable), so no browser download is involved. ' +
      'System prompts and reasoning are omitted from conversation.md unless configured otherwise; the raw log remains complete.',
    parameters: {
      include_workspace: {
        type: 'boolean',
        description: 'true = also scan the working directory for files modified since session start (even when per-turn change summaries exist); false = skip all workspace-change copies. Omit for the deployment default (auto).',
      },
      include_raw_log: {
        type: 'boolean',
        description: 'Include the raw session.v4.jsonl event log. Default true.',
      },
      output_dir: {
        type: 'string',
        description: 'Optional absolute output directory. Defaults to Desktop/DSH-Exports (or <home>/DSH-Exports).',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderExport(value) }],
    },
    isConcurrencySafe: () => false,
    timeoutMs: 600_000,
    async execute (args, exec) {
      const session = exec.agent?.session
      if (session === undefined || session === null) {
        throw new Error('export_session_bundle can only be called from inside an agent session')
      }
      const effective = {
        ...config,
        ...(args.include_workspace === undefined ? {} : { includeWorkspace: args.include_workspace === true ? 'always' : 'never' }),
        ...(args.include_raw_log === undefined ? {} : { includeRawLog: args.include_raw_log === true }),
        ...(typeof args.output_dir === 'string' && args.output_dir.trim().length > 0 ? { outputDir: args.output_dir.trim() } : {}),
      }
      return await exportSessionBundle({ ctx, config: effective, session, signal: exec.signal, source: 'tool' })
    },
  })
}
