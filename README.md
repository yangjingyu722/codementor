# CodeMentor

**Embed an engineering-cognition learning system into your AI coding workflow.**

You keep building with OpenCode, Codex, Claude Code or any AI coding agent. CodeMentor turns every _"why did we build it this way?"_ into a durable, verifiable, practicable engineering asset — instead of letting it evaporate in a chat transcript.

> **中文说明**：见下方[中文说明](#中文说明)。CodeMentor 把 AI 编程中每个设计决策的"为什么"变成可积累、可验证、可练习的工程资产——本地优先，零遥测。

**Status**: early development, `v0.1.0` ready for review (not yet published). See [docs/RELEASE_NOTES_v0.1.0.md](docs/RELEASE_NOTES_v0.1.0.md).

## What it is not

- **Not a log viewer.** Session logs answer _"what did the AI do"_ — never _why, what else was considered, which reasons were actually verified_.
- **Not a code explainer.** Post-hoc explanations are labelled `rationalized` and never presented as original intent. Reasons declared _before_ the code existed are `declared` and timestamp-provable.
- **Not a chat tool.** Everything is anchored to your repositories, tasks, commits and source lines.

## How it works

1. **Declare before implementing.** The agent registers each design decision (question, chosen option, rejected alternatives, rationale) _before_ writing code. `declaredAt` is stamped by the local service — not forgeable by the client.
2. **Grade every reason by its epistemic origin.** Claims are `declared` (pre-code intent), `observed` (machine-checkable facts: tests, diffs, builds) or `rationalized` (post-hoc explanations). Integrity rules (R1–R5) make post-hoc fabrication detectable and prevent it from masquerading as intent. See [docs/CONTRACTS.md](docs/CONTRACTS.md).
3. **Anchor to real code.** Decisions link to commit + symbol + line range + content hash. When code drifts, symbols are re-located; when they cannot be, anchors become explicitly `ambiguous` or `missing` — never silently wrong.
4. **Learn from your own decisions.** A five-step flow (Problem → Predict → Explain → Verify → Transfer) is generated deterministically from real decision data. Grading is rule-based; AI scoring, when it arrives, will never be treated as ground truth.

## Getting started

### Step 0 — Prerequisites

- Node.js ≥ 20 and pnpm 8 (`npm i -g pnpm@8` or `corepack enable`)
- Git
- VS Code ≥ 1.90 (or a compatible VS Code-based editor)

### Step 1 — Build the project

```bash
git clone https://github.com/yangjingyu722/codementor.git
cd codementor
pnpm install
pnpm build
pnpm package:vscode        # produces the installable extension:
                           # apps/vscode/dist/codementor-0.1.0.vsix
```

### Step 2 — Install the VS Code extension

```bash
code --install-extension apps/vscode/dist/codementor-0.1.0.vsix
```

For VS Code-based editors (Cursor, Trae, …) that don't share the `code` CLI:
Extensions panel → `…` menu → **Install from VSIX…** → select the file above.

### Step 3 — Start the local core service (keep it running)

```bash
pnpm --filter @codementor/server start
```

Windows shortcut: double-click **`启动CodeMentor.cmd`** in the repo root — it
auto-installs/builds on first run and starts the service.

It listens on `127.0.0.1` only, with a per-run token written to
`~/.codementor/server.json`. All data stays in `~/.codementor/codementor.db`.

### Step 4 — Feed in decision data (pick ONE of three paths)

**Path A — you use an AI agent (recommended, fully automatic).**
Register the MCP server + OpenCode plugin in your project (two small files, exact
contents in [docs/MCP_SETUP.md](docs/MCP_SETUP.md)). From then on the agent
declares decisions before coding and records verification evidence after — you do
nothing by hand.

**Path B — you code yourself and want to keep the design record.**
One command, interactive Q&A:

```bash
node tools/record-decision.mjs
```

**Path C — just want to see it working.**
Load the two bundled demo projects (a simple C project and a simplified RISC-V
process-scheduling example):

```bash
node demo/seed-demo.mjs
```

### Step 5 — Open your project in VS Code and use it

Open the **project root folder** (the one registered above). In the CodeMentor
side bar you get:

- **Decision tree**: Project → Task → Decision → anchored symbol, with status
  icons (declared / implemented / verified; confirmed / ambiguous / missing).
- **Decision detail**: the design question, rejected alternatives, the chosen
  option, and the rationale split by epistemic origin (🟢 declared · 🔵 observed ·
  🟠 rationalized — never mixed), with clickable code links and verification
  evidence.
- **CodeLens**: functions carrying a decision show
  `◆ 设计决策：…` above them — click to jump back to the decision.
- **Learning**: "开始学习" in the detail view runs the five-step flow
  (predict → explain → verify → transfer) with rule-based feedback; progress
  survives restarts.
- **"重新验证锚点"**: after code changes, re-locate anchors; stale ones are
  explicitly marked — never silently wrong.

Full walkthrough: [docs/USER_GUIDE.md](docs/USER_GUIDE.md) · Demos:
[docs/DEMOS.md](docs/DEMOS.md) · MCP setup: [docs/MCP_SETUP.md](docs/MCP_SETUP.md).

## Architecture

```
apps/
  vscode/            VS Code extension — pure view layer (tree / detail / CodeLens / learning)
  server/            local core service — loopback HTTP + token, 24 endpoints
packages/
  contracts/         Zod schemas, epistemic-origin taxonomy, integrity rules R1-R5
  storage/           SQLite (better-sqlite3) + versioned migrations
  decision-engine/   task & decision lifecycle, server-stamped timestamps
  code-mapping/      tree-sitter (C) parsing, read-only Git, anchoring & re-location
  learning-engine/   deterministic 5-step learning flow, rule-based grading
  mcp/               MCP stdio server — 5 mentor_* tools, pure forwarding layer
  opencode-adapter/  OpenCode plugin events -> normalized AgentEvents
docs/                PRD / architecture / contracts / ADRs / guides / audit
demo/                Demo A (simple C) and Demo B (RISC-V process scheduling) + seed script
tools/               record-decision.mjs — one-command decision recording
```

Layering rule: **all business logic lives in the core service packages**; the
extension and the MCP adapter are thin forwarders with no database access
(ADR-0007/0009). Everything consumes the same API — one source of truth.

## Quality

- **150 Vitest tests** (24 files) + **8 real-VSCode extension tests** — real
  processes, files, sockets and git repositories; no mocked integrations.
  Statement coverage 78.6% over `packages/*/src` + `apps/server/src`. The MCP
  stdio transport runs as a spawned subprocess, outside v8 instrumentation —
  it is covered by real-protocol integration tests instead
  (see `tests/mcp.integration.test.ts`).
- Full chain (`build -> typecheck -> lint -> format -> test`) green locally
  (Windows) and on GitHub CI (ubuntu, Node 20).
- `pnpm audit --prod`: 0 known vulnerabilities.
- Security model: [SECURITY.md](SECURITY.md). Quality audit incl. the _"AI
  fabricating design rationale"_ defence-in-depth checklist:
  [docs/QUALITY_AUDIT.md](docs/QUALITY_AUDIT.md).

## Documentation

- [User Guide](docs/USER_GUIDE.md) · [Demo Guide](docs/DEMOS.md) · [MCP Setup](docs/MCP_SETUP.md)
- [Architecture](docs/ARCHITECTURE.md) · [Data Contracts](docs/CONTRACTS.md) · [Local API](docs/LOCAL_API.md)
- [Architecture Decision Records](docs/decisions/) · [Quality Audit](docs/QUALITY_AUDIT.md) · [Changelog](CHANGELOG.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Architecture changes require an ADR. Run `pnpm verify` before committing — CI runs exactly the same chain.

## License

[MIT](LICENSE). Local-first: no telemetry, no uploads — your code and learning data never leave your machine.

---

## 中文说明

**把工程认知学习系统嵌入你的 AI 编程工作流。**

你继续用 OpenCode、Codex、Claude Code 等 AI Agent 写代码；CodeMentor 把每个"为什么这样设计"变成可积累、可验证、可练习的资产，而不是消失在会话滚动记录里。

### 它不是什么

- **不是日志查看器**：日志回答"AI 做了什么"，回答不了"为什么、还考虑过什么、哪个理由被验证过"。
- **不是代码解释器**：事后生成的解释被标记为 `rationalized`（事后推断），与编码前声明（`declared`，时间戳可证）严格区分，永不混淆。
- **不是聊天工具**：所有数据锚定在你的仓库、任务、commit 与代码行上。

### 核心机制

1. **先声明，后实现**：Agent 在写代码前把设计决策（问题、所选方案、被否决的备选、理由）登记到本地服务；`declaredAt` 由服务端时钟盖章，客户端不可伪造。
2. **认知来源分级**：理由分为 `declared`（事前意图）/ `observed`（机器可核查事实）/ `rationalized`（事后解释），完整性规则 R1-R5 让事后编造可被检测（详见 [docs/CONTRACTS.md](docs/CONTRACTS.md)）。
3. **锚定真实代码**：决策绑定 commit + 符号 + 行范围 + 内容哈希；代码漂移后符号优先重定位，无法定位时显式标记 `ambiguous` / `missing`，绝不静默错位。
4. **用自己的决策学习**：问题 → 方案判断 → 解释 → 代码验证 → 独立练习；内容确定性生成自真实决策数据；评分基于规则，AI 评分永不作为事实。

### 启动与使用流程（五步）

**第 0 步 · 环境准备**：Node ≥ 20、pnpm 8、Git、VS Code ≥ 1.90（或兼容的 VS Code 分支编辑器）。

**第 1 步 · 构建与打包**：

```bash
git clone https://github.com/yangjingyu722/codementor.git
cd codementor
pnpm install
pnpm build
pnpm package:vscode        # 产出可安装的扩展：apps/vscode/dist/codementor-0.1.0.vsix
```

**第 2 步 · 安装扩展**：

```bash
code --install-extension apps/vscode/dist/codementor-0.1.0.vsix
```

VS Code 分支编辑器（Cursor/Trae 等）不共用 `code` 命令：扩展面板 → `…` 菜单 → **从 VSIX 安装** → 选择上面的文件。

**第 3 步 · 启动本地核心服务**（保持运行）：

```bash
pnpm --filter @codementor/server start
```

Windows 快捷方式：双击项目根目录的 **`启动CodeMentor.cmd`**——首次运行自动安装依赖并构建，之后直接启动服务。

只监听 `127.0.0.1`，端口与 token 写入 `~/.codementor/server.json`；数据保存在 `~/.codementor/codementor.db`，重启服务自动恢复。

**第 4 步 · 产生决策数据（三条路径二选一）**：

- **路径 A · 用 AI Agent（推荐，全自动）**：在项目里放两个小文件注册 MCP + OpenCode 插件（照抄 [docs/MCP_SETUP.md](docs/MCP_SETUP.md)）。之后 Agent 写代码前自动声明决策、完成后自动登记验证证据，你无需手工操作。
- **路径 B · 自己写代码想留记录（一条命令）**：`node tools/record-decision.mjs`，按问答输入即可；重复执行自动复用进行中的任务。
- **路径 C · 先看效果**：`node demo/seed-demo.mjs` 装入两个自带示例工程（简单 C 工程 + 简化 RISC-V 进程调度）。

**第 5 步 · 打开项目使用**：用 VS Code 打开**已注册的项目根文件夹**，侧栏 CodeMentor 提供：

- **决策树**：Project → Task → Decision → 锚点，状态一目了然（已声明/已实现/已验证；已确认/无法精确定位/已失效）；
- **决策详情**：设计问题、被否决的备选、最终选择，理由**按可信来源三区呈现**（🟢 事前声明 · 🔵 观察事实 · 🟠 事后推断），关联代码可点击跳转；
- **CodeLens**：承载决策的函数上方显示 `◆ 设计决策：…`，点击反向查看；
- **学习**：详情页"开始学习"→ 方案判断/代码验证/独立练习，进度跨会话保留；
- **重新验证锚点**：代码变更后一键重定位；定位不到的显式标记，绝不静默错位。

### 文档索引

[用户指南](docs/USER_GUIDE.md) · [Demo 指南](docs/DEMOS.md) · [MCP 接入](docs/MCP_SETUP.md) · [架构](docs/ARCHITECTURE.md) · [数据契约](docs/CONTRACTS.md) · [本地 API](docs/LOCAL_API.md) · [ADR](docs/decisions/) · [质量审计](docs/QUALITY_AUDIT.md) · [更新记录](CHANGELOG.md)

### 当前状态

`v0.1.0` 待审（未发布）。已知边界：学习内容为确定性模板（LLM 评分预留且永不作事实）、源码解析仅支持 C（TypeScript 计划中）、服务需手动启动（自动拉起为阶段 7 候选）。详见 [Release Notes](docs/RELEASE_NOTES_v0.1.0.md) 与 [质量审计](docs/QUALITY_AUDIT.md)。
