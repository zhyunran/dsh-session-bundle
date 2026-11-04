/**
 * Slash-command handler for `/bundle`.
 *
 * @module dsh-session-bundle/command
 */

import { exportSessionBundle } from './bundle.js'
import { renderCommand, renderFailure } from './render.js'

/**
 * @param {{ ctx: any, config: Readonly<Record<string, any>> }} input
 * @returns {(invocation: any) => Promise<{ kind: 'success' | 'error', text: string }>}
 */
export function createCommandHandler ({ ctx, config }) {
  return async function bundleCommand (invocation) {
    if (typeof invocation?.rawInput === 'string' && invocation.rawInput.trim().length > 0) {
      return { kind: 'error', text: '用法：/bundle（不接受参数；输出目录由插件配置 outputDir 指定）' }
    }
    const session = invocation?.agent?.session
    if (session === undefined || session === null) {
      return { kind: 'error', text: '导出失败：当前命令没有关联的会话。' }
    }
    try {
      const result = await exportSessionBundle({ ctx, config, session, signal: invocation.signal, source: 'command' })
      return { kind: 'success', text: renderCommand(result) }
    } catch (error) {
      if (invocation?.signal?.aborted) return { kind: 'error', text: '导出已取消。' }
      try {
        ctx.logger?.error?.(`dsh-session-bundle: command export failed: ${error && error.message ? error.message : String(error)}`)
      } catch {
        /* logging is best effort */
      }
      return { kind: 'error', text: renderFailure(error) }
    }
  }
}
