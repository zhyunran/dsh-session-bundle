import assert from 'node:assert/strict'
import test from 'node:test'
import { renderConversation } from '../lib/markdown.js'
import { assistantEvent, changesEvent, presentedEvent, titleEvent, toolCallEvent, toolResultEvent, turnEnd, turnStart, userEvent } from './helpers.mjs'

const ref = { attachmentId: 'sha256:abc', name: 'spec.pdf', bytes: 42 }

function sample () {
  return {
    session: { header: { cwd: 'C:\\work' } },
    events: [
      titleEvent(0, '测试会话'),
      turnStart(1, 1),
      userEvent(2, '按这个规格做', { source: { kind: 'agent-message', senderSessionId: 'session-A' }, files: [ref] }),
      assistantEvent(3, '收到，先写文件。', {
        toolCalls: [{ id: 'call-1', name: 'write', arguments: '{"file_path":"out/result.md","content":"hi"}' }],
        reasoning: 'internal reasoning',
      }),
      toolCallEvent(4, { callId: 'call-1', name: 'write', arguments: '{"file_path":"out/result.md","content":"hi"}' }),
      toolResultEvent(5, { callId: 'call-1', text: 'Wrote out/result.md' }),
      presentedEvent(6, 1, [{ path: 'out/result.md', description: '最终报告' }]),
      changesEvent(7, 1),
      turnEnd(8, 1),
    ],
    meta: {
      id: 'session-test',
      title: '测试会话',
      cwd: 'C:\\work',
      createdAt: 1_700_000_000_000,
      model: { provider: 'deepseek-official', model: 'deepseek-flash' },
      turns: 1,
      messages: 2,
      toolCalls: 1,
      lastSeq: 8,
    },
    files: [
      { zipPath: 'files/attachments/spec.pdf', kind: 'attachment', sourcePath: undefined, name: 'spec.pdf', bytes: 42 },
      { zipPath: 'files/produced/result.md', kind: 'produced', sourcePath: 'C:\\work\\out\\result.md', name: 'result.md', bytes: 2 },
      { zipPath: 'workspace/src/changed.ts', kind: 'workspace-changed', sourcePath: 'C:\\work\\src\\changed.ts', name: 'changed.ts', bytes: 10 },
    ],
    attachmentPaths: new Map([['sha256:abc', 'files/attachments/spec.pdf']]),
    changes: [{
      turn: 1,
      total: 2,
      listed: 1,
      added: 12,
      deleted: 3,
      files: [{ path: 'C:\\work\\src\\changed.ts', display: 'src/changed.ts', added: 12, deleted: 3, zipPath: 'workspace/src/changed.ts' }],
    }],
    options: { includeReasoning: false, maxMessageChars: 2000, maxToolChars: 4000 },
    generatedAt: 1_700_000_100_000,
    source: 'command',
  }
}

test('renders a readable turn with source, attachment link and tool details', () => {
  const markdown = renderConversation(sample())
  assert.match(markdown, /^# 测试会话/m)
  assert.match(markdown, /## Turn 1/)
  assert.match(markdown, /> 按这个规格做/)
  assert.match(markdown, /agent message from `session-A`/)
  assert.match(markdown, /\[spec\.pdf\]\(<files\/attachments\/spec\.pdf>\)/)
  assert.match(markdown, /Tool call — <code>write<\/code>/)
  assert.match(markdown, /Tool result — <code>write<\/code>/)
  assert.match(markdown, /Presented files/)
  assert.match(markdown, /src\/changed\.ts/)
  assert.match(markdown, /Files changed this turn/)
  assert.match(markdown, /_Turn 1 ended: completed\._/)
  assert.doesNotMatch(markdown, /internal reasoning/)
  assert.doesNotMatch(markdown, /You are an AI agent/)
  assert.match(markdown, /## Bundled files/)
})

test('reasoning is included only when configured', () => {
  const input = sample()
  const markdown = renderConversation({ ...input, options: { ...input.options, includeReasoning: true } })
  assert.match(markdown, /<summary>Reasoning<\/summary>/)
  assert.match(markdown, /internal reasoning/)
})

test('messages are truncated with a visible note', () => {
  const input = sample()
  const markdown = renderConversation({ ...input, options: { ...input.options, maxMessageChars: 3 } })
  assert.match(markdown, /_\(message truncated\)_/)
})

test('injected runtime context is omitted by default but can be included', () => {
  const input = sample()
  input.events.splice(2, 0, userEvent(99, 'runtime injected context', { source: { kind: 'runtime-context' } }))
  const markdown = renderConversation(input)
  assert.doesNotMatch(markdown, /runtime injected context/)
  assert.match(markdown, /injected context message/)

  const included = renderConversation({ ...input, options: { ...input.options, includeInjectedContext: true } })
  assert.match(included, /runtime injected context/)
})
