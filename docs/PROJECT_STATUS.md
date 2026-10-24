# 项目状态

更新日期：2026-10-24 · 状态标记：PASS / FAIL / BLOCKED / NOT_RUN

## 当前阶段

**阶段 5：工程认知学习引擎 —— PASS（已实际验证，含 RISC-V 端到端验收与服务重启进度恢复）**

## 阶段完成情况

| 阶段/任务            | 状态    | 说明                                                                                                                              |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 阶段 0 / 1 / 3 / 4   | PASS    | 已验收（6f4dcd7 / cd8b592 / cf3ef8f / ed7b0e2，前三者经 GitHub CI 验证）                                                          |
| 阶段 2               | NOT_RUN | 经所有者调整顺延，待下达                                                                                                          |
| 阶段 5：学习任务模型 | PASS    | Exercise（flowStep/options/hints/answerKey）+ Attempt（level/gradedBy）；存储 0003 迁移（学习表与决策表分离）                     |
| 阶段 5：教学内容生成 | PASS    | 确定性模板：predict_choice/locate_code/open_explanation 全部派生自真实数据；缺锚点→跳过定位题；无主张→拒绝生成（不造假）          |
| 阶段 5：渐进式学习   | PASS    | 三级学习（1 完整引导/2 提示式/3 独立）；提示按级别披露；recommendLevel 由最近作答派生                                             |
| 阶段 5：反馈机制     | PASS    | 选择/定位/rubric 三类确定性评分；gradedBy 记录评分来源（llm 永不作事实）；反馈引用真实备选/锚点/要点                              |
| 阶段 5：VS Code 交互 | PASS    | 详情页学习区：开始学习/方案判断/查看解释/查看代码证据/提交练习/查看反馈；源码导航不受影响（原 8 项扩展测试全绿）                  |
| 阶段 5：测试         | PASS    | Vitest **124/124**（新增 learning 12 + HTTP 5 + RISC-V 验收 7 + 契约 1）；Extension Tests **8/8**（新增学习 2 项）；vsce 打包通过 |
| 阶段 5：文档         | PASS    | ADR-0008；CONTRACTS 2.8/2.9 扩展；LOCAL_API 学习路由；架构/README 更新                                                            |

## 仓库内包状态

| 包                       | 职责                                  | 构建              | 测试                     |
| ------------------------ | ------------------------------------- | ----------------- | ------------------------ |
| packages/contracts       | 数据契约 + 完整性规则（学习字段扩展） | PASS              | PASS（30）               |
| packages/storage         | SQLite 持久化 + 迁移（0001–0003）     | PASS              | PASS                     |
| packages/decision-engine | 决策工作流业务规则                    | PASS              | PASS                     |
| packages/code-mapping    | 解析/Git/锚定引擎                     | PASS              | PASS                     |
| packages/learning-engine | 学习引擎（确定性生成 + 评分）         | PASS              | PASS（12）               |
| apps/server              | 核心服务宿主（18 端点）               | PASS              | PASS                     |
| apps/vscode              | 扩展视图层（含学习交互）              | PASS（vsce 打包） | PASS（真实 VS Code 8/8） |

## 本阶段发现并修复的问题

1. **postMessage 挂起**：VS Code `webview.postMessage` 的 Thenable 在 webview 未就绪时可能永不 settle，await 它导致扩展测试 90s 超时；改为 fire-and-forget（`Promise.resolve(...).catch`，注意 Thenable 无 `.catch`）。
2. **answerKey 剥离不彻底**：`{...exercise, answerKey: undefined}` 保留键（值 undefined），`in` 检查仍为 true；改为解构剥离（键真正消失）。测试中断引发的句柄泄漏（EPERM）一并消除。
3. **Windows kill 不运行退出清理**：验收测试重启服务时残留 server.json 指向旧端口；测试显式清理发现文件。
4. **定位题提示词含误导示例**：模板示例 "proc.c scheduler" 泄漏进所有定位题导致测试选题歧义；改为中性示例 "main.c main"。

## 阻塞问题

无。

## 已知非阻塞事项

1. 本地目录名 `SumaryList`（会话占用；无功能影响）。
2. 阶段 4/5 提交已推送（ed7b0e2/ed13be1），CI run 40077495039 于 ubuntu 全绿（124/124）。
3. 阶段 2 顺延；扩展测试 CI 化（xvfb）与项目命名留待阶段 6。

## 进入下一阶段的条件

- [x] 阶段 5 验收标准满足（见阶段报告）
- [ ] 所有者确认阶段 5 验收；下达阶段 6（完整集成与开源发布）或阶段 2（MCP，经调整顺序）
