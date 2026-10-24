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

## Try it (60 seconds)

```bash
git clone https://github.com/yangjingyu722/codementor.git
cd codementor
pnpm install && pnpm build
pnpm package:vscode                            # build the installable extension (vsix)
pnpm --filter @codementor/server start        # terminal 1 — local core service
code --install-extension apps/vscode/dist/codementor-0.1.0.vsix
node demo/seed-demo.mjs                        # terminal 2 — load two demo projects
# open demo/demo-b-riscv-os in VS Code → CodeMentor side bar → start learning
```

Full walkthrough: [docs/USER_GUIDE.md](docs/USER_GUIDE.md) · Demos: [docs/DEMOS.md](docs/DEMOS.md).

## Architecture

```
apps/
  vscode/            VS Code extension — pure view layer (tree / detail / CodeLens / learning)
  server/            local core service — loopback HTTP + token, 18 endpoints
packages/
  contracts/         Zod schemas, epistemic-origin taxonomy, integrity rules R1-R5
  storage/           SQLite (better-sqlite3) + versioned migrations
  decision-engine/   task & decision lifecycle, server-stamped timestamps
  code-mapping/      tree-sitter (C) parsing, read-only Git, anchoring & re-location
  learning-engine/   deterministic 5-step learning flow, rule-based grading
docs/                PRD / architecture / contracts / ADRs / guides / audit
demo/                Demo A (simple C) and Demo B (RISC-V process scheduling) + seed script
```

Layering rule: **all business logic lives in the core service packages**; the extension is a pure view layer with zero runtime npm dependencies (ADR-0007). Every agent (future MCP) and the extension consume the same API — one source of truth.

## Quality

- **131 Vitest tests** (18 files) + **8 real-VSCode extension tests** — real processes, files, sockets and git repositories; no mocked integrations. Statement coverage 90.3%.
- Full chain (`build -> typecheck -> lint -> format -> test`) green locally (Windows) and on GitHub CI (ubuntu, Node 20).
- `pnpm audit --prod`: 0 known vulnerabilities.
- Security model: [SECURITY.md](SECURITY.md). Quality audit incl. the _"AI fabricating design rationale"_ defence-in-depth checklist: [docs/QUALITY_AUDIT.md](docs/QUALITY_AUDIT.md).

## Documentation

- [User Guide](docs/USER_GUIDE.md) · [Demo Guide](docs/DEMOS.md)
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

### 快速开始

见上方英文 "Try it" 区块（含 `pnpm package:vscode` 打包扩展步骤）；完整指南见 [docs/USER_GUIDE.md](docs/USER_GUIDE.md)，示例演示见 [docs/DEMOS.md](docs/DEMOS.md)。

### 当前状态

早期开发阶段，`v0.1.0` 待审（未发布）。已知边界：MCP 适配顺延（Agent 经 HTTP API 接入）、学习内容为确定性模板（LLM 评分预留且永不作事实）、源码解析仅支持 C。详见 [Release Notes](docs/RELEASE_NOTES_v0.1.0.md) 与 [质量审计](docs/QUALITY_AUDIT.md)。
