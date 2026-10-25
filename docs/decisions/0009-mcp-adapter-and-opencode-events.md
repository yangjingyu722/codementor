# ADR-0009：Agent 接入采用 MCP stdio 薄适配层 + OpenCode 插件事件归一化

- 状态：已接受（阶段 2）
- 日期：2026-10-24
- 影响：packages/mcp、packages/opencode-adapter、apps/server（/api/events）、AgentEvent 契约扩展

## 背景

阶段 2 恢复执行：Agent 需要能登记任务/决策/验证（MCP 工具），OpenCode 的事件需要归一化入库（观察事实的上游）。总约束：MCP Server 不得绕过核心服务；降级时不得伪造事前声明。

## 决策

1. **MCP Server = 纯转发层**（`packages/mcp`，stdio）：5 个工具（mentor_start_task / record_decision / record_verification / finish_task / get_context），全部经核心服务 HTTP API，零 SQL 访问。declaredAt 等信任锚点在核心服务盖章，MCP 层无时钟注入面。
2. **工具 Schema 用 JSON Schema**（additionalProperties:false）而非 Zod——避免与工作区 zod 4 的 SDK 耦合；核心服务引擎仍用 Zod 做最终校验（双层校验）。
3. **会话项目根**：mentor_start_task 建立的 projectRoot 记入会话状态，后续工具沿用；支持显式覆盖。
4. **OpenCode 适配器**（`packages/opencode-adapter`）：插件工厂返回 `event` 处理器；事件类型显式映射（file._/session._/tool.*/message.*→对应类型，未知→other）；**隐私净化**：嵌套对象不透传、凭据类键改写 [redacted]；服务不可达时**静默降级**（绝不阻塞 Agent 开发）。
5. **AgentEvent 入库**：迁移 0004（agent_events + task_id 可空外键）；POST /api/events 按 projectRoot 解析项目并归属最新活跃任务；GET /api/tasks/:id/events 查询。
6. **降级语义**：不调用 MCP → 无任何决策被创建（契约层 declaredClaims≥1 拒绝空声明）；文件变化仍可形成锚点提案（observed 分析）；事后分析经 HTTP 只能产生 rationalized 主张。

## 备选方案

- **MCP Server 直连 SQLite**：被验收标准禁止（旁路完整性规则与时钟盖章）。
- **高层 McpServer API + Zod 工具定义**：与工作区 zod 4 存在版本耦合风险；低层 Server + JSON Schema 更稳。
- **适配器读日志/私有数据**：违反隐私边界，仅使用事件回调提供的显式字段。

## 后果与风险

- MCP 子进程依赖 `server.json` 发现：服务未启动时 MCP 进程打印引导信息退出（Agent 端工具不可用但不产生脏数据）。
- OpenCode 真实回合验证遇到网关延迟（antigravity/gemini-2.5-flash 7 分钟未完成编辑，已终止）——真实联动标记 BLOCKED（见 docs/TEST_REPORT.md「阶段 2 验证记录」节，该节记录了完整尝试过程）；协议层已由真实 stdio 集成测试覆盖（6/6）。
