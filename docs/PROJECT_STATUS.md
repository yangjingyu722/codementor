# 项目状态

更新日期：2026-10-24 · 状态标记：PASS / FAIL / BLOCKED / NOT_RUN

## 当前阶段

**阶段 1：核心数据模型与本地服务 —— PASS（已实际验证）**

（阶段 0 已于同日验收通过，详见下表与 git 历史。）

## 阶段完成情况

| 阶段/任务                                    | 状态 | 说明                                                                                            |
| -------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| 阶段 0 全部任务                              | PASS | 2026-10-24 验收（基线提交 6f4dcd7）                                                             |
| 阶段 1：SQLite 存储（packages/storage）      | PASS | better-sqlite3 + 版本化迁移（ADR-0003）；五实体建表；读路径契约校验兜底                         |
| 阶段 1：决策引擎（packages/decision-engine） | PASS | 任务/决策生命周期；declaredAt 服务端盖章；verify 前瞻性完整性门（R1–R5）；观察/事后推断路径分离 |
| 阶段 1：本地核心服务（apps/server）          | PASS | 真实进程；回环 HTTP + Bearer token + server.json 发现（ADR-0004）；优雅退出                     |
| 阶段 1：真实测试                             | PASS | 56/56 通过：存储 8、引擎 10、HTTP 集成 7、子进程集成 3、契约回归 28                             |
| 阶段 1：文档                                 | PASS | ADR-0003/0004、docs/LOCAL_API.md、架构图与 README 更新                                          |

## 仓库内包状态

| 包                       | 职责                    | 构建 | 测试                                    |
| ------------------------ | ----------------------- | ---- | --------------------------------------- |
| packages/contracts       | 数据契约 + 完整性规则   | PASS | PASS（28）                              |
| packages/storage         | SQLite 持久化 + 迁移    | PASS | PASS（8，真实临时库文件）               |
| packages/decision-engine | 决策工作流业务规则      | PASS | PASS（10，时钟注入 + 真实存储）         |
| apps/server              | 核心服务宿主进程        | PASS | PASS（HTTP 7 + 子进程 3，真实回环连接） |
| apps/vscode              | 扩展骨架（阶段 4 实现） | PASS | 不适用（无逻辑）                        |

## 本阶段发现并修复的缺陷（测试驱动）

1. `verifyDecision` 的 R4 门在升级前状态上评估"verified 不变式"——会在无证据时错误放行；改为按假定升级后状态评估（前瞻检查）。
2. `loadConfig` 未对环境变量端口做 coerce，字符串 '0' 导致进程启动即崩溃。
3. 超限请求体处理销毁 socket，客户端收到连接重置而非 413；改为 Content-Length 预检 + 溢出排水。

## 阻塞问题

无。远端仓库与 CI 已建立（2026-10-24）：

- 远端：https://github.com/yangjingyu722/codementor（私有；按总控计划，转公开留待阶段 6 开源发布）
- CI 已在 GitHub 实际运行并通过：run `40067608847`（ubuntu-latest，install→build→typecheck→lint→format→test 全绿，56/56 测试）

已知非阻塞事项：

1. 本地目录名 `SumaryList`（会话进程占用无法在会话内改名）；无功能影响，git 仓库名独立为 `codementor`。
2. 项目名与 codementor.io 相近（阶段 6 前决策，涉及潜在改名时需同步调整包名 `@codementor/*` 与文档）。

## 进入阶段 2 的条件

- [x] 阶段 1 验收标准满足（见阶段报告）
- [x] 阶段 2 任务已由项目所有者下达（MCP 与 Agent 接入）
- [ ] 项目所有者确认阶段 1 验收，批准开工

阶段 2 将交付：MCP Server（mentor_* 五工具，经核心服务 HTTP API 落库，不绕过核心）、OpenCode 事件适配器、降级机制（不伪造事前声明；事后分析标记 rationalized）、Mock 与真实 Agent 测试分别报告。
