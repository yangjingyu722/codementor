# 项目状态

更新日期：2026-10-24 · 状态标记：PASS / FAIL / BLOCKED / NOT_RUN

## 当前阶段

**阶段 3：源码分析与设计决策映射 —— PASS（已实际验证）**

阶段顺序说明：阶段 0、1 已验收；**阶段 2（MCP 与 Agent 接入）经所有者调整顺延**（阶段 3 不硬依赖阶段 2——映射引擎消费存储层既有 Decision 记录），待所有者重新下达。

## 阶段完成情况

| 阶段/任务                          | 状态    | 说明                                                                                                |
| ---------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| 阶段 0 全部任务                    | PASS    | 2026-10-24 验收（提交 6f4dcd7）                                                                     |
| 阶段 1 全部任务                    | PASS    | 2026-10-24 验收（提交 cd8b592；CI 实跑全绿 run 40067608847/40067863621）                            |
| 阶段 2                             | NOT_RUN | 顺延，待所有者下达                                                                                  |
| 阶段 3：源码解析（C，Tree-sitter） | PASS    | 函数/结构体/typedef 提取；前置声明排除；语法错误降级；SourceParser 抽象留 TS 扩展位（ADR-0005）     |
| 阶段 3：Git 变更分析               | PASS    | 只读 GitClient：变更识别/diff hunk/历史内容/HEAD；版本钉住 0.22.4+0.23.4                            |
| 阶段 3：CodeAnchor v0.2 契约与存储 | PASS    | symbolKind/contentHash/status/origin/anchoredAt；0002 迁移；双向查询（决策→锚点、符号→决策）        |
| 阶段 3：映射失效检测               | PASS    | 符号优先重定位；重命名跟随（git -M）；ambiguous/missing 显式标记；绝不删除/凭空造符号/跨文件猜测    |
| 阶段 3：设计关联（认知三角）       | PASS    | 符号存在=observed；关联判断=anchor.origin(declared/inferred)；理由推断=rationalized；自动提案不落库 |
| 阶段 3：真实测试                   | PASS    | 92/92：新增 35（解析 9、Git 5、映射场景 12、proc 验收 5、HTTP 锚点 4）+ 存量回归                    |
| 阶段 3：文档                       | PASS    | ADR-0005/0006；CONTRACTS v0.2；LOCAL_API 锚点端点；架构/README 更新                                 |

## 仓库内包状态

| 包                       | 职责                                     | 构建 | 测试                                 |
| ------------------------ | ---------------------------------------- | ---- | ------------------------------------ |
| packages/contracts       | 数据契约 + 完整性规则（CodeAnchor v0.2） | PASS | PASS（29）                           |
| packages/storage         | SQLite 持久化 + 迁移（0001/0002）        | PASS | PASS（8）                            |
| packages/decision-engine | 决策工作流业务规则                       | PASS | PASS（10）                           |
| packages/code-mapping    | 解析/Git/锚定引擎                        | PASS | PASS（26：解析 9 + Git 5 + 映射 12） |
| apps/server              | 核心服务宿主（含锚点端点）               | PASS | PASS（HTTP 7+4 + 子进程 3 + 验收 5） |
| apps/vscode              | 扩展骨架（阶段 4 实现）                  | PASS | 不适用（无逻辑）                     |

## 本阶段发现并修复的问题（测试与探针驱动）

1. **tree-sitter 版本 ABI 配对**：0.24.1 语法包（新绑定格式）与核心 0.22.4 不兼容，运行时崩溃；实测钉住 `tree-sitter@0.22.4 + tree-sitter-c@0.23.4`（证据与过程见 ADR-0005）。
2. **Vitest ESM 互操作破坏 NAPI 对象**：`import C from 'tree-sitter-c'` 被 Vite 包装后失效；改 `createRequire` 原生加载。
3. 服务端错误映射补全：StorageError(NOT_FOUND/CONFLICT) 此前会 500，现映射 404/409。

## 阻塞问题

无。远端 https://github.com/yangjingyu722/codementor（私有）。

## 已知非阻塞事项

1. 本地目录名 `SumaryList`（会话占用无法改名；无功能影响）。
2. 阶段 3 提交尚未推送远端（总控规则：推送需所有者授权）——推送后 CI 将在 ubuntu 上验证 tree-sitter 原生模块的 Linux 预编译可用性（探针已验证 Windows；Linux 预编译为该官方包常规发布物）。
3. 项目名与 codementor.io 相近（阶段 6 决策）。

## 进入下一阶段的条件

- [x] 阶段 3 验收标准满足（见阶段报告）
- [ ] 所有者确认阶段 3 验收，并下达下一阶段（阶段 2 或阶段 4）
