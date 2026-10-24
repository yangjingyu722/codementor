# 测试报告

更新日期：2026-10-24 · 环境：Windows 10 (26200) x64 · Node v24.12.0 · pnpm 8.13.1 · Vitest 2.1.9 / TypeScript 5.9.3 / ESLint 9.39.5 / Prettier 3.9.10 / better-sqlite3 12.x

本报告只记录**实际执行**的命令与结果。CI（.github/workflows/ci.yml）执行与本地相同的脚本链路（顺序：install → build → typecheck → lint → format:check → test）。

## 阶段 1 验证记录（2026-10-24）

| #   | 命令                                                         | 结果                                          | 退出码 |
| --- | ------------------------------------------------------------ | --------------------------------------------- | ------ |
| 1   | better-sqlite3 独立探针（临时目录 npm install + 内存库读写） | PROBE_OK（Node 24 可用原生二进制）            | 0      |
| 2   | `pnpm install`（新增 storage/decision-engine/server 依赖）   | 成功，10.3s                                   | 0      |
| 3   | `pnpm build`（首次）                                         | **失败**：decision-engine 3 处 TS2322         | 2      |
| 4   | `pnpm build`（修复 Zod 输入类型推断问题后）                  | 成功：5 包全部产出 dist                       | 0      |
| 5   | `pnpm typecheck`                                             | 成功：根 + 5 包全部通过                       | 0      |
| 6   | `pnpm lint`（首次）                                          | **失败**：1 处未使用变量                      | 1      |
| 7   | `pnpm lint`（修复后）                                        | 成功：0 错误 0 警告                           | 0      |
| 8   | `pnpm format` / `format:check`                               | 成功                                          | 0      |
| 9   | `pnpm test`（第 1 次）                                       | **7 失败** / 46 通过 / 3 跳过                 | 1      |
| 10  | `pnpm test`（第 2 次，修复 3 个缺陷后）                      | **2 套件失败** / 53 通过                      | 1      |
| 11  | `pnpm test`（第 3 次，修复测试清理问题后）                   | **56 通过 / 0 失败 / 0 跳过**（7 文件，1.5s） | 0      |
| 12  | `pnpm verify`（build→typecheck→lint→format:check→test 全链） | 全部通过                                      | 0      |
| 13  | `git status` / `git diff`（提交后）                          | 工作区干净                                    | 0      |

### 失败问题及修复（如实记录）

| 问题                                          | 根因                                                                           | 修复                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| build 失败：schema 默认值字段类型含 undefined | 泛型 `ZodType<T>` 在 Input≠Output 时把 T 推断为输入类型                        | 改用 `ZodTypeAny` + `S['_output']`       |
| 测试失败：verify 在无证据时不拒绝             | **真实缺陷**：R4 是 verified 状态的不变式，但升级前状态是 declared，检查被空转 | 前瞻检查：在假定升级后的状态上评估完整性 |
| 进程测试超时（套件失败）                      | **真实缺陷**：环境变量端口为字符串，`z.number()` 拒绝，进程启动即崩            | `z.coerce.number()`                      |
| 413 测试收到连接重置                          | **真实缺陷**：超限时销毁 socket，响应无法送达                                  | Content-Length 预检 + 溢出排水（不销毁） |
| 引擎测试时间戳全相同                          | 测试时钟未自增（测试缺陷）                                                     | now() 自增并输出秒精度                   |
| HTTP 套件 EPERM 清理失败                      | 测试内第二个存储连接未关闭，Windows 句柄未释放                                 | 测试内显式 close + closeAllConnections   |
| 篡改测试 UPDATE 失败                          | origin 列有 CHECK 约束                                                         | 改篡改无约束的 statement 列              |
| lint 未使用变量                               | 测试解构多余                                                                   | 移除                                     |

## 测试明细（阶段 1 后累计 56 个）

| 文件                                         | 数量 | 覆盖                                                                                                                                                                                  |
| -------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/contracts/test/entities.test.ts     | 17   | 契约实体合法/非法样例、默认值                                                                                                                                                         |
| packages/contracts/test/integrity.test.ts    | 8    | R1–R5 完整性规则                                                                                                                                                                      |
| packages/storage/test/storage.test.ts        | 8    | 迁移登记、五实体往返、**关闭重开持久化**、外键/唯一冲突、列表过滤、**外部篡改读路径拦截**、事务回滚                                                                                   |
| packages/decision-engine/test/engine.test.ts | 10   | 幂等注册、**服务端时钟盖章**、声明门槛（min 1 declared）、状态机（任务/决策）、观察→验证升级、**R4 拒绝路径**、rationalized 不充当声明/证据、**回填 producedAt 被 R5 拦截**、输入校验 |
| tests/decision-lifecycle.test.ts             | 3    | 契约层端到端（阶段 0 回归）                                                                                                                                                           |
| tests/server.http.test.ts                    | 7    | 真实回环 HTTP：health/401/完整工作流(声明→观察→实现→验证→读取)/400/422/404/405/413/**跨连接持久化**                                                                                   |
| tests/server.process.test.ts                 | 3    | **真实子进程**：spawn 构建产物 → server.json 握手 → health → 鉴权声明 → 终止                                                                                                          |

## 测试哲学说明

- 数据库为真实 SQLite 文件（临时目录），HTTP 为真实回环 socket，进程测试 spawn 真实 Node 进程——全程无 Mock。
- 引擎时钟为构造注入（DI），这是可测性设计而非 Mock 冒充：被测系统仍是真实引擎+真实存储。

## 说明与限制

- CI 未在 GitHub 实际运行（仓库未推送远端，属授权范围外动作）；本地已按 CI 完全相同的命令与顺序执行通过。
- 真实 OpenCode Agent 集成测试属阶段 2 范围，本阶段未涉及。
