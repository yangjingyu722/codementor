# 质量审计报告（阶段 6 · 2026-10-24）

本报告逐项记录阶段 6 质量审查的实际检查方法与结论。所有结论基于真实检查，无主观断言。

## 1. 数据契约一致性

- **方法**：docs/CONTRACTS.md 的字段表与 `packages/contracts/src/entities.ts` 的 Zod schema 逐实体对照；契约测试（30 项）含全部实体的合法样例与非法拒绝。
- **结论**：一致。CodeAnchor v0.2 与 Exercise/Attempt 阶段 5 扩展均已同步文档。zod 4 迁移（`z.record` 显式键类型）后 131/131 测试通过。

## 2. 核心业务逻辑：**"AI 事后编造设计理由并显示为真实记录"防线**

本项目的核心风险专项。逐条防线与证据：

| 防线                                        | 实现                                                                                | 测试证据                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| declaredAt 由服务端时钟盖章，客户端不可回填 | `DecisionEngine.declareDecision` 忽略输入中的时间                                   | engine.test「服务端时钟盖章」                                     |
| 事后解释永不升级为事前声明                  | `recordRationalization` 固定 origin=rationalized；契约层无任何升级 API              | engine.test「recordRationalization 永远标记为 rationalized」      |
| 声明必须先于观察证据（时序红线）            | 完整性规则 R5：declaredAt 不得晚于最早 producedAt                                   | engine.test「回填 producedAt 被 R5 拦截」+ 契约 integrity.test    |
| 无 declared 主张的"决策"不成立              | R1 + 引擎输入 schema 强制 declaredClaims ≥ 1                                        | engine.test「declaredClaims 为空时拒绝」                          |
| verified 必须由证据授予                     | R4 前瞻检查：假定升级后仍需受支撑的 observed 主张                                   | engine.test「R4 拒绝路径」+ HTTP 422 用例                         |
| 自动匹配只提案不落库                        | `proposeAnchors` 无写路径；落库必经 createAnchor（declared/inferred 显式标注）      | mapping.test「自动提案绝不落库」                                  |
| 学习内容零虚构                              | 无锚点→无定位题；无主张→拒绝生成；rubric 关键词全部来自真实记录                     | learning.test「要求4」「缺 claims 拒绝生成」+ RISC-V Explain 断言 |
| UI 来源呈现不混淆                           | Webview 三区分离（declared/observed/rationalized）+ inferred 锚点显式标注"自动关联" | 人工测试步骤（TEST_REPORT 阶段 5）                                |

**结论**：存在纵深防御（时钟、schema、完整性规则、API 面、UI 标注五层），未发现可绕过路径把事后解释伪装为事前记录。

## 3. 插件生命周期

- activate 注册资源全部进入 `context.subscriptions`；deactivate 为空（无可释放的后台资源；服务进程独立于扩展，符合 ADR-0001 进程隔离）。
- 服务离线：树显式节点 + 状态栏提示，无轮询、无弹窗风暴；loader 带 5s TTL 缓存与并发去重（inflight 复用）。

## 4. 事件处理

- HTTP：请求体 1MB 上限 + Content-Length 预检 + 溢出排水（不销毁 socket）；统一错误协议；鉴权 timing-safe 比较。
- 已知边界（v0.1 明示）：核心服务为单进程同步 SQLite，无多客户端写并发控制需求（单用户本地场景）。

## 5. 源码映射正确性

- 8 个规定漂移场景 + ambiguous（条件编译双定义）+ 语法错误降级 + 重命名跟随，全部有真实 git fixture 测试（packages/code-mapping 26 项）。
- 绝不静默错位：无法精确定位 → ambiguous/missing 显式状态；绝不跨文件猜测回退；绝不创建解析不存在的符号。

## 6. 学习内容证据

- 见第 2 节防线表"学习内容零虚构"行。rubric 关键词来源可追溯（备选名/所选方案/主张片段/符号名），反馈逐句引用真实记录。

## 7. 异常处理

- 存储层：NOT_FOUND/CONFLICT 结构化错误；读路径契约校验兜底（外部篡改在读取边界暴露——有测试）。
- 服务端：引擎/存储/Git 错误分级映射（400/404/405/409/413/422/500），未知错误 500 且不泄露堆栈。
- 扩展：所有用户命令 try/catch；学习消息处理失败 → 面板内错误状态 + 非模态提示。

## 8. 本地服务权限

- 仅绑定 `127.0.0.1`（config 层 `z.literal('127.0.0.1')`，无配置面）；Bearer token（启动时随机 256-bit，timing-safe 比较）；除 `/health` 外全部鉴权。
- server.json 含明文 token——威胁模型限定为同用户本机进程（与 Docker socket、VS Code server 同级），已在 ADR-0004 与 SECURITY.md 明示。

## 9. 用户数据隐私

- **grep 全量检查**：`apps/*/src` 与 `packages/*/src` 中除回环地址与注释性引用外，**零外部 URL、零遥测、零上传**。
- 数据全部落本机：SQLite（`<CODEMENTOR_HOME>/codementor.db`）+ server.json。卸载 = 删除数据目录。

## 10. 性能

实测（本机 Windows，Node 24，真实 SQLite 文件，性能抽测脚本）：

| 操作                          | 耗时                    |
| ----------------------------- | ----------------------- |
| 初始化（建库+迁移+项目+任务） | 28.6 ms                 |
| 200 决策 + 200 学习会话写入   | 331 ms（≈1.65 ms/决策） |
| 列出 200 决策                 | 7.6 ms                  |
| 读取单决策学习会话            | 0.41 ms                 |

结论：单用户本地场景余量充足；无 N+1 查询（锚点/主张批量查询）。已知量级上限：tree-sitter 解析为按需同步调用，超大型仓库全量重验证为 O(锚点数)——v0.1 可接受，阶段 7+ 可增量。

## 11. 依赖安全

- `pnpm audit --prod`：**0 漏洞**（zod 3→4 升级修复了 1 个 high：GHSA-mrhx-c7xc-m3w5，迁移代价 1 行 `z.record` 签名）。
- devDependencies 审计：21 项（3 low / 10 moderate / 5 high / 3 critical），全部位于构建/测试工具链（esbuild、glob 等传递依赖），**不进入运行时与发布物**（vsce 包 12 文件、22.65 KB，零运行时 npm 依赖）；已在 SECURITY.md 记录与跟进策略。

## 12. 测试覆盖情况

- 覆盖率（v8 provider，阶段 6 实测）：**语句 90.31% / 分支 84.73% / 函数 96.66%**（覆盖范围：packages/*/src + apps/server/src）。
- 数量：131 Vitest（18 文件）+ 8 真实 VS Code 扩展测试。全部为真实进程/文件/socket 测试，无 Mock 冒充（时钟注入为 DI 设计）。

## 13. 遗留风险清单

1. 原生模块（better-sqlite3、tree-sitter）绑定 Node 大版本与 ABI 配对——版本精确钉住 + 探针流程已文档化（ADR-0003/0005）。
2. 扩展测试未进 CI（需 ubuntu xvfb job）——以本地真实 VS Code 运行为准。
3. 单 token 明文落盘（本地威胁模型内可接受，见 SECURITY.md）。
