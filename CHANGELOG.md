# Changelog

## 0.1.2 — 2026-11-04

- Report the real ZIP size separately from the copied file payload; the command/tool text previously repeated the file-payload number as if it were the archive size (the raw 7.6 MB session log made the difference obvious).

## 0.1.1 — 2026-11-04

- Omit injected user-role context (agent instructions, runtime context, approvals, job notices) from `conversation.md` by default; add `includeInjectedContext` to opt in and report the omitted count.
- Preserve workspace-relative paths for produced files (`files/produced/<relative path>`), so two plugins with the same basename no longer collide into `config-2.js`.
- 22 unit tests.

## 0.1.0 — 2026-11-04

First release.

- `/bundle` human command and `export_session_bundle` agent tool.
- ZIP written on the Host (Desktop/DSH-Exports by default), no browser download.
- `conversation.md` readable transcript: per-turn sections, sources, tool calls/results in collapsible blocks, attachment links, presented files, per-turn changed-file lists, final inventory.
- `session.v4.jsonl` raw durable log (optional).
- `manifest.json` with counts, hashes and skip reasons.
- File collection unions attachments, `deliverables/presented`, `write`/`edit` tool calls, `workspace/changes` summaries (Host memory), and an optional modified-file scan.
- Dependency-free STORE ZIP writer (CRC-32, UTF-8 names, central directory).
- Config: output directory, workspace mode, size caps, truncation, ignore list.
- 21 unit tests; real `dsh-tools` schema compile; end-to-end verified on DSH 0.2.0-rc.2.
