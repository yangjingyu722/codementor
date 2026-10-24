# CodeMentor

嵌入 AI 编程工作流的工程认知学习系统。

你继续用 OpenCode、Codex、Claude Code 等 AI Agent 写代码；CodeMentor 负责让"为什么这样设计"变成可积累、可验证、可练习的资产——而不是消失在会话滚动记录里。

## 它不是什么

- 不是执行日志查看器：日志只能回答"AI 做了什么"，回答不了"为什么、还考虑过什么、哪个理由被验证过"。
- 不是代码解释器：事后生成的解释全部被标记为 `rationalized`（事后推断），与编码前**声明**的设计意图（`declared`）严格区分，永不混淆。
- 不是 AI 聊天工具：它绑定在你的仓库、任务、commit 和代码行上。

## 核心机制

1. **先声明，后实现**：Agent 通过 MCP 工具在写代码前登记决策与理由；时间戳 + 完整性规则保证声明的先后顺序可被验证。
2. **认知来源分级**：每条主张标注 `declared / observed / rationalized`，见 [docs/CONTRACTS.md](docs/CONTRACTS.md)。
3. **锚定与练习**：决策通过 commit + 符号路径锚定到代码，并可派生练习题形成学习闭环。

## 当前状态

**早期开发中（阶段 0 已完成）**。项目按七个阶段推进，进度与验证记录见 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) 与 [docs/TEST_REPORT.md](docs/TEST_REPORT.md)。

| 阶段 | 内容                                    | 状态                           |
| ---- | --------------------------------------- | ------------------------------ |
| 0    | 需求设计、架构、数据契约、Monorepo 骨架 | ✅                             |
| 1    | 核心数据模型与本地服务                  | ✅                             |
| 2    | MCP 服务与 Agent 适配                   | ⬜（顺序经所有者调整，待下达） |
| 3    | 源码分析与设计关联                      | ✅                             |
| 4    | VS Code 插件                            | ✅                             |
| 5    | 工程学习引擎                            | ✅                             |
| 6    | 完整集成与开源发布                      | ⬜                             |

## 仓库布局

```
apps/
  vscode/            VS Code 扩展：决策树 / 详情 / CodeLens（纯视图层）
  server/            本地核心服务：回环 HTTP + token（已实现，见 docs/LOCAL_API.md）
packages/
  contracts/         数据契约：Zod schema + 完整性规则
  storage/           SQLite 存储层：better-sqlite3 + 版本化迁移
  decision-engine/   决策引擎：生命周期 + 完整性规则执行
  code-mapping/      代码映射引擎：Tree-sitter(C) + 只读 Git + 锚定/失效检测
  learning-engine/   学习引擎：真实决策生成五步学习流 + 确定性评分
docs/                PRD / 架构 / 契约 / ADR / API / 状态与测试报告
tests/               根级集成测试（HTTP / 子进程 / proc 验收 / 锚点）
```

## 开发

要求：Node ≥ 20，pnpm 8（`package.json` 的 `packageManager` 字段钉住了版本）。

```bash
pnpm install          # 安装依赖
pnpm verify           # build + typecheck + lint + format:check + test
```

单项命令见根 `package.json` 的 `scripts`；CI（`.github/workflows/ci.yml`）执行与本地完全相同的链路。

## 文档

- [产品需求文档（PRD）](docs/PRD.md)
- [系统架构](docs/ARCHITECTURE.md)
- [数据契约](docs/CONTRACTS.md)
- [架构决策记录](docs/decisions/)
- [贡献指南](CONTRIBUTING.md)

## 许可

[MIT](LICENSE) · 本地优先：核心功能零网络依赖，不上传你的代码与会话数据。
