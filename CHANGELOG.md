# Changelog / 更新记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式与
[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added（2026-10-25，阶段 2）

- **MCP Server**（`@codementor/mcp`）：stdio 传输，5 个 `mentor_*` 工具（start_task /
  record_decision / record_verification / finish_task / get_context），JSON Schema 严格
  校验；纯转发层（不触碰存储），declaredAt 由核心服务时钟盖章。
- **OpenCode 事件适配器**（`@codementor/opencode-adapter`）：事件归一化 + 隐私净化 +
  服务不可达时静默降级；AgentEvent 入库（迁移 0004/0005，归属活跃任务，**可按 session
  查询**）。
- **决策登记工具**（`tools/record-decision.mjs`）：对任意仓库一条命令登记任务/决策/锚点。
- 端点数 21 → 24（events 入库 / 按任务查询 / **按 session 查询**）。
- 文档：ADR-0009、[docs/MCP_SETUP.md](docs/MCP_SETUP.md)。

### 计划

- 扩展测试 CI 化（ubuntu + xvfb）、TypeScript 语言支持、commit-time ≤ declaredAt 自动校验。

## [0.1.0] - 2026-10-24

首个可用版本。围绕真实工程决策的完整闭环：声明 → 实现 → 锚定 → 学习。

### Added / 新增

- **数据契约**（`@codementor/contracts`）：9 个实体的 Zod schema 与认知来源分类学
  （`declared / observed / rationalized`），以及决策完整性规则 R1–R5 的可执行实现。
- **SQLite 存储**（`@codementor/storage`）：better-sqlite3 + 版本化迁移（0001–0003）；
  读路径契约校验兜底。
- **决策引擎**（`@codementor/decision-engine`）：任务/决策生命周期；declaredAt 服务端
  时钟盖章；verify 采用前瞻完整性检查；观察证据与事后推断路径分离。
- **代码映射引擎**（`@codementor/code-mapping`）：tree-sitter C 解析（函数/结构体/typedef）、
  只读 Git 客户端、CodeAnchor 锚定、符号优先重定位与失效检测
  （confirmed / ambiguous / missing）、自动关联提案（只提案不落库）。
- **学习引擎**（`@codementor/learning-engine`）：Problem→Predict→Explain→Verify→Transfer
  五步流程；三级渐进学习；确定性评分（gradedBy 治理，LLM 永不作事实）；进度由作答派生。
- **本地核心服务**（`apps/server`）：21 个端点；回环 HTTP + Bearer token + server.json 发现。
- **VS Code 扩展**（`apps/vscode`）：决策树（Project→Task→Decision→Anchor）、按认知来源
  分区的详情 Webview、CodeLens 反向入口、跳转与失效警示、五步学习交互。
- **示例工程**：Demo A（简单 C 工程）与 Demo B（简化 RISC-V 进程调度）+ 一键种子脚本。
- **测试**：131 项 Vitest（真实进程/文件/socket，无 Mock 冒充）+ 8 项真实 VS Code 扩展测试；
  语句覆盖率 90.3%。
- **文档**：中英双语 README、架构文档、数据契约、8 份 ADR、用户指南、Demo 指南、
  质量审计报告、安全策略。

### Known Limitations / 已知限制

- MCP Agent 适配未包含（Agent 经核心服务 HTTP API 接入；阶段 2 顺延）。
- 学习内容为确定性模板；LLM 生成/评分未实现（接口位已预留，永不作为事实依据）。
- 扩展测试未接入 CI（需 ubuntu xvfb job）。
- 源码解析仅支持 C（TypeScript 支持为后续计划，`SourceParser` 抽象已就绪）。

[Unreleased]: https://github.com/yangjingyu722/codementor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yangjingyu722/codementor/releases/tag/v0.1.0
