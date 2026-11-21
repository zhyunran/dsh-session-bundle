# dsh-session-bundle

**English** 路 [**涓枃**](README.md)

**English** · [中文](README.zh.md)

**One command, one ZIP: a readable conversation + the files this session actually produced + every attachment.** `/bundle` in DSH, or ask the agent to `export_session_bundle`.

---

## What core DSH already has (checked before building this)

DSH ships `@deepseek-ai/dsh-session-log-export`, exposed as the **`/export`** command and the Session-header **"Download session log"** menu item. It downloads a ZIP containing:

- the root session's raw `session.vN.jsonl` log (plus child sessions);
- every **attachment** referenced by those logs (`media/…`, `files/…`).

It does **not** render a readable transcript, and it does **not** copy the files the session wrote, edited, presented, or changed in its working directory. `present` itself even documents that its files are declarations, not content, in the session ZIP.

Several community plugins export readable Markdown/HTML/PDF transcripts. Per their published descriptions they focus on the **conversation**, not the **working-directory artifacts** produced alongside it.

This plugin fills that gap: **conversation + produced files + attachments, one ZIP, written on the Host.**

## Use

### Human: `/bundle`

Type `/bundle` in the session you want to export. No arguments.

```
/bundle
```

The ZIP is written to `Desktop/DSH-Exports/` on Windows (or `<home>/DSH-Exports/`), and the command result shows the exact path.

### Agent: `export_session_bundle`

Ask the agent: *"把这个对话和它产出的文件导出成一个包"* — it calls:

```json
{
  "include_workspace": true,   // optional: force a modified-file scan
  "include_raw_log": true,     // optional
  "output_dir": "D:/exports"   // optional
}
```

No browser download, no file picker: the ZIP lands on disk.

## What's inside

```
README.txt
conversation.md        readable transcript
session.v4.jsonl       raw durable event log (JSON Lines)
manifest.json          machine-readable file index, counts, skips
files/
  attachments/         bytes of every file/image attachment in the conversation
  produced/            files from `present`, `write`, `edit`, `str_replace_editor` (workspace-relative paths)
  external/            changed files outside the working directory
workspace/             copies of files the session changed in its working directory
```

`conversation.md` includes:

- header: session id, working directory, created/exported time, model, turns, message/tool counts;
- each turn as `## Turn N`;
- user messages with their source (`user`, `agent message from <session>`, `schedule`, …);
- assistant prose;
- collapsible tool call/result blocks with arguments and truncated output;
- attachment links into `files/attachments/`;
- **presented files** and **per-turn changed files** with links into the bundle;
- a final inventory table of every bundled file.

System prompts, developer messages, request headers, reasoning and injected runtime context are omitted from `conversation.md` (reasoning and injected context can be enabled); `session.v4.jsonl` is the raw source of truth.

## How "files produced by this session" are found

The collector unions, in this order, deduplicating by absolute path:

1. **Attachments** — every `file`/`image` block in user, assistant and tool-result content; bytes come from the attachment store.
2. **Presented files** — canonical `deliverables/presented` events (with the `present` tool call as fallback).
3. **File-tool writes** — `write`, `edit`, `str_replace_editor` calls, resolved against the session working directory.
4. **Workspace-change summaries** — `workspace/changes` events + `ctx.workspaceChanges.summary()`: the Host's git-worktree/file-tool snapshot of files changed per turn. This catches both file-tool edits and (in a git repo) shell-created output. These summaries live in Host memory only, so after a restart they may be gone.
5. **Modified-file scan** — used when `includeWorkspace: auto` and no summaries exist (or always with `always`): files under the working directory with mtime ≥ session start, skipping `.git`, `node_modules`, caches, virtualenvs, etc.

Deleted files are recorded in `manifest.json` as skipped (`missing (deleted or moved)`); their **content** cannot be recovered from disk, only their names/counts in the change summary.

Everything is size-capped (see configuration) and hashed with SHA-256 in the manifest.

## Configuration

Override in your profile layer:

```yaml
# <DSH_HOME>/profiles/<profile>/cordis.patch.yml
- id: dsh-session-bundle
  config:
    outputDir: 'D:/exports'     # default: Desktop/DSH-Exports or <home>/DSH-Exports
    includeWorkspace: auto      # auto | always | never
    includeAttachments: true
    includeRawLog: true
    includeReasoning: false
    includeInjectedContext: false
    maxFileBytes: 52428800          # 50 MiB per file
    maxTotalBytes: 314572800        # 300 MiB per bundle
    maxWorkspaceFiles: 300
    maxWorkspaceBytes: 209715200    # 200 MiB for workspace copies
    maxToolChars: 4000              # per tool call/result in conversation.md
    maxMessageChars: 20000          # per message in conversation.md
    maxRawLogBytes: 52428800
    ignoreNames: ['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.next', '.cache']
```

| Field | Default | Meaning |
|---|---|---|
| `outputDir` | `''` | Host output directory; empty selects `Desktop/DSH-Exports` then `<home>/DSH-Exports`. |
| `includeWorkspace` | `auto` | `auto` = summaries if present else scan; `always` = summaries + scan; `never` = no workspace-change copies (explicit produced files still included). |
| `includeAttachments` | `true` | Copy attachment bytes. |
| `includeRawLog` | `true` | Include `session.v4.jsonl`. |
| `includeReasoning` | `false` | Include reasoning blocks in `conversation.md`. |
| `includeInjectedContext` | `false` | Include injected user-role context (agent instructions, runtime context, approvals, job notices) in `conversation.md`. |
| `maxFileBytes` | 50 MiB | Per-file cap. |
| `maxTotalBytes` | 300 MiB | Total attachment + produced budget. |
| `maxWorkspaceFiles` | 300 | Scan cap. |
| `maxWorkspaceBytes` | 200 MiB | Total workspace-copy budget. |
| `maxToolChars` / `maxMessageChars` | 4000 / 20000 | Readable-copy truncation. |
| `maxRawLogBytes` | 50 MiB | Raw log cap; omitted when larger. |
| `ignoreNames` | sensible defaults | Directory/file names skipped by the scan. |

A bad config falls back to defaults with a logged error; it never prevents DSH from booting.

## Install

Requires DSH **0.2.x**. No build step and no runtime dependencies.

```powershell
# local tarball (absolute path)
dsh plugin --profile <profile> add C:\path\to\dsh-session-bundle-0.1.2.tgz

# or GitHub tarball (git not required)
dsh plugin --profile <profile> add https://codeload.github.com/<owner>/dsh-session-bundle/tar.gz/<40-char-commit>

# or npm, if published
dsh plugin --profile <profile> add dsh-session-bundle
```

Restart DSH once after install. Then type `/` — `bundle` should appear in the command list.

## Status

- 22 unit tests pass (`node --test test/*.test.mjs`): ZIP structure/CRC, config, Markdown, collection/dedup/budgets, full bundle, tool and command handlers.
- The tool declaration compiles with the real `dsh-tools` schema compiler.
- End-to-end verified on DSH 0.2.0-rc.2 (see below): a real session exported through the tool produced a ZIP whose `conversation.md`, `session.v4.jsonl`, `manifest.json`, attachments and workspace copies were all readable, and whose changed files matched the session's own `workspace/changes` summaries.

## Differences from existing exports

| Feature | Core `/export` | Readable transcript plugins | **dsh-session-bundle** |
|---|---|---|---|
| Raw session log | ✅ | varies | ✅ `session.v4.jsonl` |
| Readable Markdown transcript | ❌ | ✅ | ✅ `conversation.md` |
| Attachment bytes | ✅ | varies | ✅ `files/attachments/` |
| Files written/presented by the session | ❌ | ❌ | ✅ `files/produced/` |
| Files changed in the working directory | ❌ | ❌ | ✅ `workspace/` |
| Output on Host disk (no browser picker) | ❌ | varies | ✅ |
| One command / one tool call | `/export` | varies | `/bundle` · `export_session_bundle` |

## Limitations

- Exports the **current** session only (no child-session tree). The raw log is the root session's own log.
- `workspace/changes` summaries are in Host memory: after a DSH restart, `auto` falls back to the modified-file scan, which can be broader (or miss shell changes in a non-git directory).
- STORE-only ZIP: maximum compatibility and zero dependencies, at the cost of larger archives for text-heavy bundles.
- No PDF/HTML rendering; no cloud upload; no incremental/differential export.
- Files changed in a turn partly by the user are counted as changed; the bundle is a snapshot, not an attribution proof.

## Development

```powershell
node --test test/*.test.mjs
npm pack --pack-destination dist
```

Layout:

```
lib/index.js      plugin entry (name / inject / apply)
lib/command.js    /bundle handler
lib/tool.js       export_session_bundle tool
lib/bundle.js     snapshot → collect → render → zip
lib/collect.js    attachments / presented / writes / changes / scan
lib/markdown.js   readable transcript
lib/zip.js        dependency-free STORE ZIP writer
lib/config.js     policy + output directory
lib/session.js    snapshot + metadata
lib/render.js     tool/command text
lib/util.js
```

## Publishing

```powershell
git init
git add .
git commit -m "dsh-session-bundle 0.1.2"
git branch -M main
git remote add origin https://github.com/<owner>/dsh-session-bundle.git
git push -u origin main
```

Attach `dist/dsh-session-bundle-0.1.2.tgz` to a `v0.1.2` release. To publish to npm: `npm publish --access public`.

## License

MIT. See [LICENSE](LICENSE).

---

Built for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
