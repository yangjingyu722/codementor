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

- CI 已在 GitHub 实际运行并通过：阶段 1（run 40067608847 / 40067863621）、阶段 3（run 40071533849，92/92）、阶段 4+5（run 40077495039，124/124）。扩展测试（test:vscode）未接入 CI（需 xvfb），以本地真实 VS Code 运行为准。

## 阶段 6 验证记录（2026-10-24 追加）

环境：Windows 10 x64 · Node v24.12.0 · VS Code 1.143.1

| #   | 检查项                                                  | 结果                                                                                                    | 退出码 |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| 1   | 单元/集成测试 `pnpm test`                               | **131/131**（18 文件；新增 e2e 全流程 5 + demo seed 2）                                                 | 0      |
| 2   | 端到端全流程（9 步数据流，tests/e2e.full-flow.test.ts） | **5/5**：需求→任务→声明→改码→变化分析（提案）→锚定→展示数据就绪→学习（错→对）→持久化+验证闭环+任务完成  | 0      |
| 3   | MCP 集成测试                                            | **NOT_RUN**——阶段 2 顺延，无 MCP 封装可测                                                               | —      |
| 4   | Agent 真实联动测试                                      | **NOT_RUN**——依赖阶段 2 MCP；已以真实 HTTP Agent 客户端替代驱动全流程                                   | —      |
| 5   | VS Code 扩展测试 `pnpm test:vscode`                     | **8/8**（真实 VS Code 1.143.1）                                                                         | 0      |
| 6   | 静态类型 `pnpm typecheck`                               | 全部通过（zod 4 迁移后）                                                                                | 0      |
| 7   | Lint/格式                                               | 0 错误 / 全部符合（demo .mjs 增加 globals 配置）                                                        | 0      |
| 8   | 插件打包 `vsce package`                                 | 成功：codementor-0.1.0.vsix（12 文件，22.65 KB）                                                        | 0      |
| 9   | **全新环境安装测试**                                    | 真实 `git clone` 到临时目录 → `pnpm install --frozen-lockfile`（2m0s）→ build → **124/124**（当时提交） | 0      |
| 10  | 依赖安全 `pnpm audit --prod`                            | 升级 zod 3→4 修复 1 high 后：**0 漏洞**（dev 依赖 21 项告警不进运行时/发布物）                          | 0      |
| 11  | 覆盖率（@vitest/coverage-v8）                           | 语句 **90.31%** / 分支 84.73% / 函数 96.66%                                                             | —      |
| 12  | 性能抽测                                                | 200 决策+会话写入 331ms；列表 7.6ms；单会话 0.41ms（数字见 QUALITY_AUDIT.md §10）                       | —      |
| 13  | Demo 种子脚本真实运行                                   | **2/2**（两个 Demo 数据落库 + 幂等重跑）                                                                | 0      |
| 14  | 隐私 grep                                               | src 中零外部 URL/遥测（仅回环地址）                                                                     | —      |

说明：以上 131 = 124 + e2e 5 + demo seed 2；阶段 6 未新增业务功能。

### 阶段 6 GitHub CI 记录

| Run           | 提交                                                       | 结果                                                                                                    |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `40079595598` | 3684f65（demo 目录被误提交为 gitlink 的缺陷状态）          | **failure**——checkout 中 demo 目录为空，seed 脚本 `git commit` 空提交失败（缺陷的真实暴露，非环境问题） |
| `40079669874` | d23b5cf（修复：demo 以普通文件入库 + 测试清理运行时 .git） | **success**：ubuntu + Node 20，131/131 全绿                                                             |

该失败-修复过程如实保留：嵌入 .git 的 gitlink 提交导致克隆方拿不到 demo 源文件，
本地 add 时的 git 警告触发了修复；修复后 CI 全绿。

## 复审轮次记录（2026-10-24）

### 第一轮复审（M1/M2）→ 整改提交 a1b33e5（run 40082576005 全绿）

- M1：五处用户文档 vsix 死引用 → 补 `pnpm package:vscode` 步骤 + `tests/vsix.smoke.test.ts`
  按文档路径真实执行 build→package→内容校验。
- M2：PRD §4 增加 v0.1.0 交付范围裁定（F1/F4/F5/F6 交付，F2/F3 顺延 v0.2）；§8 增加发布
  闸门一致性规则。

### 第二轮复审（对抗性核查 + m9/m10）→ 整改提交见 git log

- 对抗性实测结论（评审者独立复现）：认知来源不可伪造的核心属性成立；**m9** 指出 R5 仅对
  惰性事后补写有效（蓄意时序操纵——先实现、迟到声明、再跑新测试并只登记新证据——可过
  R5；commitSha 提交时间与 declaredAt 无自动化交叉检查）；实测确认伪造 producedAt 写入放行
  （201）且读取/验证路径即时重算拦截。
- 整改：QUALITY_AUDIT §2 措辞限定为"对惰性事后补写有效" + §13 新增残余风险第 4 条 +
  CONTRACTS.md 明示"写入放行、验证拦截"语义；engine.test 固定该语义断言（写入落库事实 +
  读取拦截）。
- **m10**（说明性，无行动）：node_modules/.pnpm 中 zod@3 旧目录为 pnpm 8 不 GC 的孤儿残留，
  锁文件仅含 zod@4，全新克隆只解析锁定版本——已记入 QUALITY_AUDIT §11。
- 治理核查（评审者确认无问题）：zod 升级不触发 ADR 义务；CHANGELOG 数量声明属实；锁文件
  diff 无可疑内容。

- 真实 OpenCode Agent 集成测试属阶段 2 范围，本阶段未涉及。

## 阶段 5 验证记录（2026-10-24 追加）

环境：Windows 10 x64 · Node v24.12.0 · VS Code 1.143.1

| #   | 命令/步骤                                                                                     | 结果                                                                                                | 退出码 |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| 1   | `pnpm vitest run packages/learning-engine`（首次）                                            | 2 失败：依赖缺失（decision-engine 未声明）+ 级别推荐语义（改为"最近一次作答"）                      | 1      |
| 2   | `pnpm vitest run packages/learning-engine`（修复后）                                          | **12/12 通过**（8 条测试要求逐项覆盖 + 幂等/rubric 三档/拒绝生成）                                  | 0      |
| 3   | `pnpm vitest run tests/learning.http.test.ts tests/riscv-learning.acceptance.test.ts`（首次） | 多处失败：学习路由 python 静默替换未命中（404）、GET/POST 会话包裹不一致、盘符类问题（无）          | 1      |
| 4   | 修复路由与包裹后重跑                                                                          | 剩 4 失败：定位题提示词示例泄漏（真实缺陷，改中性示例）+ rubric 弱答案期望错误（行为正确，修测试）  | 1      |
| 5   | `pnpm test`（全量，首次）                                                                     | 2 失败：answerKey 键未真正剥离（`in` 检查）+ 连带的临时目录 EPERM                                   | 1      |
| 6   | 解构剥离修复后 `pnpm test`                                                                    | **124/124 通过**（16 文件）                                                                         | 0      |
| 7   | `pnpm test:vscode`（首次）                                                                    | 7/8：学习命令测试超时——`webview.postMessage` 的 Thenable 在 webview 未就绪时永不 settle（真实缺陷） | 1      |
| 8   | postMessage 改 fire-and-forget 后                                                             | **8/8 全部通过**（7s）                                                                              | 0      |
| 9   | `pnpm verify` 全链                                                                            | build→typecheck→lint→format→test 全绿                                                               | 0      |
| 10  | `vsce package --no-dependencies`                                                              | 打包成功（12 文件，22.65 KB）                                                                       | 0      |

### 学习功能测试明细（对照阶段测试要求）

| 要求                        | 覆盖测试                                                          |
| --------------------------- | ----------------------------------------------------------------- |
| 1 根据真实决策创建学习任务  | learning.test「要求1」+ RISC-V 准备/生成步骤                      |
| 2 答案正确时正常反馈        | 「要求2」（MCQ+定位 pass，反馈含真实方案名/位置）                 |
| 3 答案错误时针对性解释      | 「要求3」（fail 反馈引用真实备选与真实文件位置）                  |
| 4 缺少证据不生成虚假引用    | 「要求4」（无锚点→无定位题；解释不声称有证据）+ RISC-V Explain 步 |
| 5 用户回答可靠保存          | 「要求5」（落库含 level/gradedBy）+ HTTP attempts                 |
| 6 重开插件恢复进度          | 「要求6」（关库重开）+ RISC-V 服务重启步骤 + Extension Test       |
| 7 任务与 Decision 正确关联  | 「要求7」（多决策互不串扰）                                       |
| 8 不阻塞正常 Agent 开发流程 | 「要求8」（学习操作前后决策状态/完整性不变）+ HTTP 端点隔离用例   |

### RISC-V 验收场景（端到端，真实数据）

fixture：proc.h（struct context/pcb）、swtch.c（swtch，简化 C 表达 RISC-V 切换）、proc.c（scheduler）——真实 git 仓库 + 真实锚点。流程：问题呈现（真实 question）→ 方案判断先错后对（fail 反馈引用 callee-saved 真实取舍）→ 解释引用真实主张（无证据时明确不出现"已被支撑"）→ 定位 swtch/scheduler（错误反馈给出真实文件；Level 1 提示含真实位置）→ 独立解释练习（partial→pass，rubric 关键词全部来自真实记录）→ completed=true、recommendLevel=3 → **服务进程重启后进度完整恢复**。

### 人工测试步骤（自动化覆盖：无）

1. **学习区交互观感**：打开决策详情 → 点击"开始学习" → 三步卡片按序渲染；完成后卡片绿框 + "✓ 已通过"。
2. **级别披露**：Level 1 时定位题显示三条提示（含真实文件位置）；Level 3 无提示。
3. **查看代码证据**：Verify 步点击"查看代码证据" → 跳转到锚定符号行。
4. **反馈颜色**：pass 绿 / partial 橙 / fail 红（--vscode-charts-* 主题变量）。
5. **历史反馈恢复**：作答后关闭面板重新打开 → 最近反馈与完成状态仍在（数据层已有 Extension Test，DOM 呈现为人工项）。

## 阶段 4 验证记录（2026-10-24 追加）

环境：Windows 10 x64 · Node v24.12.0 · VS Code 1.143.1（@vscode/test-electron 自动下载）· vsce 3.x

| #   | 命令/步骤                                           | 结果                                                                                                               | 退出码 |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | `pnpm --filter codementor build`                    | 扩展编译通过（CJS，dist/extension.js）                                                                             | 0      |
| 2   | `npx vsce package --no-dependencies`                | **打包成功**：dist/codementor-0.1.0.vsix（12 文件，19.62 KB；README/LICENSE/图标/manifest 齐备）                   | 0      |
| 3   | `pnpm vitest run apps/vscode/test`                  | ApiClient 5/5（真实服务进程：发现/health/lookup 未注册 undefined/只读链路/错误透传）                               | 0      |
| 4   | `pnpm vitest run tests/server.anchors.http.test.ts` | 6/6（新增 lookup/tasks/anchors 三端点用例）                                                                        | 0      |
| 5   | `pnpm test:vscode`（第 1 次）                       | **失败**：套件内 spawn 服务超时——扩展宿主内 process.execPath 是 VS Code 自身                                       | 1      |
| 6   | `pnpm test:vscode`（第 2 次）                       | **失败**：种子数据决策 ID 取值路径错误（{decision:{id}}）                                                          | 1      |
| 7   | `pnpm test:vscode`（第 3 次）                       | **失败 3 项**：树与 CodeLens 断言 info/0——根因为 VS Code 工作区 URI 盘符小写化（c:\ vs C:\）导致 lookupProject 404 | 1      |
| 8   | `pnpm test:vscode`（第 4 次，realpath 修复后）      | **6/6 全部通过**（真实 VS Code 1.143.1 + 真实核心服务进程 + 真实 C 工程 fixture）                                  | 0      |
| 9   | `pnpm verify`（首次）                               | **ESLint OOM**——`.vscode-test/`（1.1GB）未忽略被全量扫描                                                           | 134    |
| 10  | ignore 修复后 `pnpm verify`                         | 全绿：build→typecheck→lint→format→test（**99/99**）                                                                | 0      |

### Extension Tests 明细（真实 VS Code 实例内运行，6/6）

| 测试                                  | 验证内容                                                              |
| ------------------------------------- | --------------------------------------------------------------------- |
| 激活并注册全部命令                    | 5 个命令全部注册（激活测试）                                          |
| 决策树 Project→Task→Decision→Anchor   | 真实种子数据（任务"实现上下文切换"、决策"全量寄存器保存"/"轮询调度"） |
| CodeLens 在 proc.c 函数上提供决策入口 | 两个函数各 1 条 lens，标题含决策名                                    |
| 从决策关联跳转到代码                  | revealAnchor 后 activeEditor=proc.c 且选中行=锚点起始行               |
| 打开决策详情面板                      | 面板创建计数递增                                                      |
| 服务停止后决策树明确提示离线          | kill 服务进程后树根为"核心服务未连接"节点                             |

测试基础设施：临时 fixture（C 工程 + git 仓库 + .vscode/settings.json 指向临时服务目录）；核心服务由套件拉起真实进程；种子数据全部经真实 HTTP API 写入。无 Mock。

### 自动化覆盖情况与人工测试步骤

以下交互依赖真实图形界面观感，无法自动断言，提供人工验证步骤（自动化覆盖：无）：

1. **主题适配**（暗/亮）：命令面板 → "首选项: 切换深色/浅色主题" → 决策树图标与详情页各区块颜色均应随主题变化且对比度可读。依据：Webview 全部使用 --vscode-* 变量，无硬编码颜色（代码审计可证）。
2. **CodeLens 视觉呈现**：打开 proc.c，函数上方应显示 "◆ 设计决策：…" 灰色小字链接；点击后详情在侧边打开。
3. **离线状态栏**：停止核心服务 → 执行 "CodeMentor: 刷新" → 右下角出现 "CodeMentor 服务未连接" 状态栏项，点击弹出帮助说明与"打开设置"操作；不应出现模态弹窗。
4. **失效关联警示**：对锚定符号做删除后触发重验证 → 决策树锚点图标变红色 "error"，点击跳转时出现非阻断警告"该设计关联已失效…显示最后已知位置"。
5. **vsix 安装**：`code --install-extension apps/vscode/dist/codementor-0.1.0.vsix` → 活动栏出现 CodeMentor 图标。

补充说明：VS Code 集成测试要求显示环境；CI 接入（ubuntu + xvfb）留待阶段 6，未包含在本轮。
