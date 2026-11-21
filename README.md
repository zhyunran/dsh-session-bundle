# dsh-session-bundle

**涓枃** 路 [**English**](README.en.md)

**中文** · [English](README.md)

**一条命令，一个 ZIP：可读对话 + 本会话真正产出的文件 + 全部附件。** 在 DSH 里输入 `/bundle`，或让 agent 调用 `export_session_bundle`。

---

## 先确认：DSH 已有什么（做之前已核查）

DSH 自带 `@deepseek-ai/dsh-session-log-export`，入口是 **`/export`** 命令和会话头部菜单里的 **「下载 Session 日志」**。它下载的 ZIP 包含：

- 根会话的原始 `session.vN.jsonl` 日志（以及子会话）；
- 日志里引用到的全部**附件**（`media/…`、`files/…`）。

它**不**生成可读文字稿，也**不**复制本会话在工作区里写入/修改/交付的文件。`present` 的文档甚至明确说明：Session ZIP 只包含声明，不包含文件内容。

社区已有若干可读 Markdown/HTML/PDF 导出插件；按它们公开的描述，重点都在**对话本身**，而不是会话同期在**工作区产出的文件**。

这个插件补的就是这一层：**对话 + 产出文件 + 附件，一个 ZIP，直接落到 Host 磁盘。**

## 用法

### 人用：`/bundle`

在想导出的会话里输入：

```
/bundle
```

不接受参数。ZIP 默认写到 Windows 的 `桌面/DSH-Exports/`（其他系统 `<home>/DSH-Exports/`），命令结果会显示完整路径。

### AI 用：`export_session_bundle`

对 agent 说「把这个对话和它产出的文件导出成一个包」，它调用：

```json
{
  "include_workspace": true,   // 可选：强制做一次修改文件扫描
  "include_raw_log": true,     // 可选
  "output_dir": "D:/exports"   // 可选
}
```

没有浏览器下载、没有文件选择框：ZIP 直接落盘。

## ZIP 结构

```
README.txt
conversation.md        可读对话文字稿
session.v4.jsonl       原始持久事件日志（JSON Lines）
manifest.json          机器可读的文件索引、计数、跳过原因
files/
  attachments/         对话里每个文件/图片附件的字节
  produced/            present / write / edit / str_replace_editor 产出的文件（保留工作区相对路径）
  external/            工作目录之外被修改的文件
workspace/             本会话在工作目录内改动过的文件副本
```

`conversation.md` 包含：

- 头部：会话 id、工作目录、创建/导出时间、模型、回合数、消息/工具调用数；
- 每个回合 `## Turn N`；
- 用户消息及其来源（`user`、`agent message from <session>`、`schedule` 等）；
- assistant 正文；
- 可折叠的工具调用/结果（参数与截断后的输出）；
- 指向 `files/attachments/` 的附件链接；
- **Presented files** 和**每回合变更文件**，带包内链接；
- 末尾完整文件清单表。

`conversation.md` 不含 system prompt、developer 消息、请求头、reasoning 和注入型运行时上下文（后两者可配置打开）；`session.v4.jsonl` 保留原始全量。

## “本会话产出的文件”是怎么找的

按顺序取并集，按绝对路径去重：

1. **附件**：user / assistant / tool-result 内容里的 `file`/`image` 块；字节从附件存储读取。
2. **present 交付文件**：规范的 `deliverables/presented` 事件（`present` 工具调用作兜底）。
3. **文件工具写入**：`write`、`edit`、`str_replace_editor` 调用，相对路径按会话工作目录解析。
4. **workspace/changes 摘要**：`workspace/changes` 事件 + `ctx.workspaceChanges.summary()`，即 Host 的 git 工作树 / 文件工具快照，按回合列出改动文件。它同时覆盖文件工具编辑和（在 git 仓库里）shell 创建的产物。**这些摘要只在 Host 内存里，重启后可能没有。**
5. **修改文件扫描**：`includeWorkspace: auto` 且没有摘要时（或 `always` 时）扫描工作目录中 mtime ≥ 会话开始的文件，跳过 `.git`、`node_modules`、各种缓存/虚拟环境等。

被删除的文件会在 `manifest.json` 里标为跳过（`missing (deleted or moved)`）——磁盘上已经没有内容，只能保留文件名/计数。

所有文件都有大小上限，并在 manifest 里带 SHA-256。

## 配置

在自己的 profile 层覆盖：

```yaml
# <DSH_HOME>/profiles/<profile>/cordis.patch.yml
- id: dsh-session-bundle
  config:
    outputDir: 'D:/exports'     # 默认：桌面/DSH-Exports 或 <home>/DSH-Exports
    includeWorkspace: auto      # auto | always | never
    includeAttachments: true
    includeRawLog: true
    includeReasoning: false
    includeInjectedContext: false
    maxFileBytes: 52428800          # 单文件 50 MiB
    maxTotalBytes: 314572800        # 整包 300 MiB
    maxWorkspaceFiles: 300
    maxWorkspaceBytes: 209715200    # workspace 副本 200 MiB
    maxToolChars: 4000              # conversation.md 中每个工具块
    maxMessageChars: 20000          # conversation.md 中每条消息
    maxRawLogBytes: 52428800
    ignoreNames: ['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.next', '.cache']
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `outputDir` | `''` | Host 输出目录；空则优先 `桌面/DSH-Exports`，其次 `<home>/DSH-Exports`。 |
| `includeWorkspace` | `auto` | `auto`=有摘要用摘要，否则扫描；`always`=摘要+扫描；`never`=不复制工作区变更（显式 produced 仍保留）。 |
| `includeAttachments` | `true` | 复制附件字节。 |
| `includeRawLog` | `true` | 包含 `session.v4.jsonl`。 |
| `includeReasoning` | `false` | 在 conversation.md 中包含 reasoning。 |
| `includeInjectedContext` | `false` | 在 conversation.md 中包含注入型 user 上下文（agent 指令、运行时上下文、审批、任务通知）。 |
| `maxFileBytes` | 50 MiB | 单文件上限。 |
| `maxTotalBytes` | 300 MiB | 附件+产出的总上限。 |
| `maxWorkspaceFiles` | 300 | 扫描文件数上限。 |
| `maxWorkspaceBytes` | 200 MiB | workspace 副本总上限。 |
| `maxToolChars` / `maxMessageChars` | 4000 / 20000 | 可读稿截断。 |
| `maxRawLogBytes` | 50 MiB | 原始日志上限，超了就不放。 |
| `ignoreNames` | 合理默认 | 扫描时跳过的目录/文件名。 |

配置写错会记录错误并使用默认值，不会阻止 DSH 启动。

## 安装

需要 DSH **0.2.x**，无构建步骤、无运行时依赖。

```powershell
# 本地 tarball（绝对路径）
dsh plugin --profile <profile> add C:\path\to\dsh-session-bundle-0.1.2.tgz

# GitHub tarball（不需要 git）
dsh plugin --profile <profile> add https://codeload.github.com/<owner>/dsh-session-bundle/tar.gz/<40位commit>

# 或 npm（如果发布）
dsh plugin --profile <profile> add dsh-session-bundle
```

装完重启一次 DSH。输入 `/`，命令列表里应出现 `bundle`。

## 状态

- 22 个单元测试全过（`node --test test/*.test.mjs`）：ZIP 结构/CRC、配置、Markdown、文件收集/去重/预算、完整导出、工具与命令 handler。
- 工具声明用真实 `dsh-tools` schema 编译器编译通过。
- 在 DSH 0.2.0-rc.2 上做了真机 E2E：通过工具导出真实会话，检查了 `conversation.md`、`session.v4.jsonl`、`manifest.json`、附件与 workspace 副本，变更文件与会话自身的 `workspace/changes` 摘要一致。

## 与现有导出的差异

| 能力 | 核心 `/export` | 可读文字稿插件 | **dsh-session-bundle** |
|---|---|---|---|
| 原始会话日志 | ✅ | 不一 | ✅ `session.v4.jsonl` |
| 可读 Markdown 文字稿 | ❌ | ✅ | ✅ `conversation.md` |
| 附件字节 | ✅ | 不一 | ✅ `files/attachments/` |
| 会话写入/present 的文件 | ❌ | ❌ | ✅ `files/produced/` |
| 工作目录内变更文件 | ❌ | ❌ | ✅ `workspace/` |
| 直接落 Host 磁盘（无浏览器选择框） | ❌ | 不一 | ✅ |
| 一条命令 / 一次工具调用 | `/export` | 不一 | `/bundle` · `export_session_bundle` |

## 已知限制

- 只导出**当前**会话，不含子会话树；原始日志是根会话自己的日志。
- `workspace/changes` 摘要只在 Host 内存：DSH 重启后 `auto` 会退回修改文件扫描，可能更宽（非 git 目录也可能漏掉 shell 改动）。
- STORE-only ZIP：最大兼容、零依赖，代价是纯文本包偏大。
- 不做 PDF/HTML 渲染、不上传云端、不做增量/差分导出。
- 一回合里用户自己也改过的文件会被计入；这个包是快照，不是“谁改了什么”的归属证明。

## 开发

```powershell
node --test test/*.test.mjs
npm pack --pack-destination dist
```

目录：

```
lib/index.js      插件入口（name / inject / apply）
lib/command.js    /bundle handler
lib/tool.js       export_session_bundle 工具
lib/bundle.js     快照 → 收集 → 渲染 → 打包
lib/collect.js    附件 / present / 写入 / 变更 / 扫描
lib/markdown.js   可读文字稿
lib/zip.js        零依赖 STORE ZIP writer
lib/config.js     配置与输出目录
lib/session.js    快照与元数据
lib/render.js     工具/命令文本
lib/util.js
```

## 发布

```powershell
git init
git add .
git commit -m "dsh-session-bundle 0.1.2"
git branch -M main
git remote add origin https://github.com/<owner>/dsh-session-bundle.git
git push -u origin main
```

把 `dist/dsh-session-bundle-0.1.2.tgz` 挂到 `v0.1.2` release。发 npm 用 `npm publish --access public`。

## 许可

MIT，见 [LICENSE](LICENSE)。

---

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 而写。
