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

## GitHub CI 实际运行记录（2026-10-24 追加）

远端仓库建立后（https://github.com/yangjingyu722/codementor ，私有），CI 首次在 GitHub 实际运行：

| 项目   | 值                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Run    | `40067608847`（push main，commit cd8b592）                                                                                            |
| 运行器 | ubuntu-latest                                                                                                                         |
| 步骤   | Install dependencies → Build → Typecheck → Lint → Format check → Test                                                                 |
| 结果   | **全部成功**（56/56 测试通过，含 better-sqlite3 原生模块与真实子进程测试在 Linux 上通过）                                             |
| 提示   | 非失败性弃用提示（actions 旧版运行时 / ubuntu 镜像迁移公告）；已升级 actions/checkout@v7、actions/setup-node@v7、pnpm/action-setup@v6 |

## 阶段 3 验证记录（2026-10-24 追加）

环境：Windows 10 x64 · Node v24.12.0 · pnpm 8.13.1 · tree-sitter 0.22.4 / tree-sitter-c 0.23.4（精确钉住）

| #   | 命令/步骤                                                    | 结果                                                                      | 退出码 |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ------ |
| 1   | tree-sitter 兼容性探针（临时目录实测两对版本）               | 0.24.1 语法包运行时崩溃（ABI 不匹配）；0.23.4 通过                        | 见记录 |
| 2   | `pnpm install`（新增 code-mapping 及原生依赖）               | 成功，预编译二进制无需编译器                                              | 0      |
| 3   | `pnpm build`（首次）                                         | **失败**：SymbolInfo 导入源写错（1 处 TS2724）                            | 2      |
| 4   | `pnpm build`（修复后）                                       | 成功：6 包产出 dist                                                       | 0      |
| 5   | `pnpm typecheck`（首次）                                     | **失败**：环境声明未纳入根程序 + 测试漏导入 beforeAll                     | 2      |
| 6   | `pnpm typecheck`（修复后）                                   | 全部通过                                                                  | 0      |
| 7   | `pnpm lint`（两次修复未使用变量/导入后）                     | 0 错误 0 警告                                                             | 0      |
| 8   | `pnpm test`（第 1 次）                                       | **12 失败**：Vitest ESM 互操作破坏 NAPI Language 对象（setLanguage 崩溃） | 1      |
| 9   | `pnpm test`（第 2 次，改 createRequire 原生加载后）          | **仍 12 失败**：根因实为语法包版本配对错误（0.24.1 新绑定格式）           | 1      |
| 10  | `pnpm test`（第 3 次，钉住 tree-sitter-c@0.23.4 后）         | **2 失败**（均为测试自身问题：提案断言名不副实、notes.md 未先创建）       | 1      |
| 11  | `pnpm test`（第 4 次）                                       | **92 通过 / 0 失败 / 0 跳过**（12 文件，12.9s）                           | 0      |
| 12  | `pnpm verify`（build→typecheck→lint→format:check→test 全链） | 全部通过                                                                  | 0      |

### 新增测试明细（35 个，累计 92）

| 文件                                           | 数量    | 覆盖                                                                                                                                                                             |
| ---------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/code-mapping/test/c-parser.test.ts    | 9       | 函数（含指针返回值）/结构体/typedef 提取、前置声明排除、同名跨文件、条件编译双定义、语法错误标记、空文件、注册表按扩展名路由                                                     |
| packages/code-mapping/test/git-client.test.ts  | 5       | HEAD、变更识别（增/改/删/重命名 -M -z）、历史内容（含不存在）、diff hunk 行号                                                                                                    |
| packages/code-mapping/test/mapping.test.ts     | 12      | 8 个规定场景（新增函数/修改函数/新增结构体/同名不同文件/位置移动/文件重命名/符号删除/语法错误）+ ambiguous 双定义 + 来源三角与提案不落库 + 路径穿越/未知类型拒绝 + 无 mtime 断言 |
| tests/proc-acceptance.test.ts                  | 5       | 验收场景：找到 PCB 与 scheduler、行号精确、关联、反向查询、变更重定位与删除标 missing                                                                                            |
| packages/contracts/test/entities.test.ts（增） | +2 用例 | CodeAnchor v0.2 默认值与非法枚举/哈希/空符号链拒绝                                                                                                                               |

测试基础设施：每个场景独立临时 git 仓库（真实 git init/commit/mv）+ 独立 SQLite 文件；无 Mock。

## 说明与限制

- CI 已在 GitHub 实际运行并通过：阶段 1（run 40067608847 / 40067863621）与**阶段 3（run 40071533849，提交 cf3ef8f，ubuntu-latest + Node 20）**——后者验证了 tree-sitter 0.22.4+0.23.4 的 Linux 预编译可用性，92/92 测试在 Linux 全绿。
- 真实 OpenCode Agent 集成测试属阶段 2 范围，本阶段未涉及。
