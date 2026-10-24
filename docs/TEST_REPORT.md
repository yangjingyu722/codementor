# 测试报告

更新日期：2026-10-24 · 环境：Windows 10 (26200) x64 · Node v24.12.0 · pnpm 8.13.1 · Vitest 2.1.9 / TypeScript 5.9.3 / ESLint 9.39.5 / Prettier 3.9.10

本报告只记录**实际执行**的命令与结果。CI（.github/workflows/ci.yml）执行与下述本地完全相同的脚本链路。

## 阶段 0 验证记录（2026-10-24）

| #   | 命令                                     | 结果                                                                        | 退出码 |
| --- | ---------------------------------------- | --------------------------------------------------------------------------- | ------ |
| 1   | `pnpm install`                           | 成功：解析 202、下载 155、安装 155 包，23s                                  | 0      |
| 2   | `pnpm format`（Prettier 写入，统一基线） | 成功                                                                        | 0      |
| 3   | `pnpm typecheck`                         | 成功：根 tsconfig + apps/vscode + apps/server + packages/contracts 全部通过 | 0      |
| 4   | `pnpm lint`（eslint .）                  | 成功：0 错误 0 警告                                                         | 0      |
| 5   | `pnpm format:check`                      | 成功："All matched files use Prettier code style!"                          | 0      |
| 6   | `pnpm test`（vitest run）                | **通过**：3 个测试文件，28 个测试，28 通过 / 0 失败 / 0 跳过，1.25s         | 0      |
| 7   | `pnpm build`（pnpm -r run build）        | 成功：3 个包均产出 dist（js + d.ts + map）                                  | 0      |
| 8   | `git status` / `git diff`（基线提交后）  | 工作区干净，无未预期改动                                                    | 0      |

## 测试明细

### packages/contracts/test/entities.test.ts — 17 通过

- 9 个实体的合法样例全部通过解析（Project/Task/Decision/Claim/Evidence/CodeAnchor/AgentEvent/Exercise/Attempt）。
- 异常路径：空 ID、带时区偏移的时间戳、非法枚举、startLine > endLine、非法 commitSha、绝对路径、非整数/非正数行号均被拒绝。
- 默认值：Claim（unverified/空证据引用）、Attempt（ungraded/空反馈）。

### packages/contracts/test/integrity.test.ts — 8 通过

- 完整场景通过；R1（无 declared 主张）、R2（悬空证据引用）、R3（observed 无证据）、R4（verified 无受支撑观察）、R5（声明晚于证据）逐一触发对应错误码；R4 修复路径复验通过；无关决策的主张被正确忽略。

### tests/decision-lifecycle.test.ts — 3 通过（根级集成）

- 从仓库根通过包入口 `@codementor/contracts` 完成"声明 → 观察 → 验证"全链路；篡改 declaredAt 被完整性校验拦截；练习/作答闭环可持久化字段校验。

## 说明与限制

- 阶段 0 的测试对象是数据契约（纯函数），无进程/IO 依赖；涉及真实进程、SQLite 与 MCP 的集成测试从阶段 1/2 起按阶段补充。
- CI 尚未在 GitHub 上实际运行（仓库未推送远端，属授权范围外）；本地已按 CI 完全相同的命令序列执行通过。
