# 项目状态

更新日期：2026-10-24 · 状态标记：PASS / FAIL / BLOCKED / NOT_RUN

## 当前阶段

**阶段 4：VS Code 插件实现 —— PASS（已实际验证，含真实 VS Code 集成测试）**

## 阶段完成情况

| 阶段/任务                | 状态    | 说明                                                                                                                                                    |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 阶段 0 / 1 / 3           | PASS    | 已验收（提交 6f4dcd7 / cd8b592 / cf3ef8f，均经 GitHub CI 验证）                                                                                         |
| 阶段 2                   | NOT_RUN | 经所有者调整顺延，待下达                                                                                                                                |
| 阶段 4：插件基础         | PASS    | 激活/停用、server.json 发现 + token 连接、工作区识别（realpath 归一盘符大小写）、配置 codementor.homeDir、离线显式状态 + 状态栏提示、错误集中于用户命令 |
| 阶段 4：决策导航树       | PASS    | Project → Task → Decision（→ Anchor 四层）；状态图标（暗/亮主题自适应）；点击决策开详情                                                                 |
| 阶段 4：设计详情 Webview | PASS    | 问题/备选/最终选择/理由/关联代码/证据；**理由按认知来源三区分离**（declared/observed/rationalized 不混排）；CSP nonce；完整性页脚                       |
| 阶段 4：源码双向关联     | PASS    | 决策 → 代码（Webview 按钮 + 树节点，reveal + 选中锚点行）；CodeLens（c/cpp）反向入口；missing/ambiguous 警示 + 最后已知位置                             |
| 阶段 4：服务端配套       | PASS    | 3 个只读查询端点（lookup/tasks/anchors）——既有存储查询的透出，无新业务（ADR-0007）                                                                      |
| 阶段 4：测试             | PASS    | Vitest 99/99（新增 ApiClient 5 + 端点 2）；**@vscode/test-electron 真实 VS Code 6/6**；vsce 打包成功（12 文件）                                         |
| 阶段 4：文档             | PASS    | ADR-0007；LOCAL_API/ARCHITECTURE/README 更新；人工测试步骤见 TEST_REPORT                                                                                |

## 仓库内包状态

| 包                       | 职责                            | 构建                  | 测试                     |
| ------------------------ | ------------------------------- | --------------------- | ------------------------ |
| packages/contracts       | 数据契约 + 完整性规则           | PASS                  | PASS                     |
| packages/storage         | SQLite 持久化 + 迁移            | PASS                  | PASS                     |
| packages/decision-engine | 决策工作流业务规则              | PASS                  | PASS                     |
| packages/code-mapping    | 解析/Git/锚定引擎               | PASS                  | PASS                     |
| apps/server              | 核心服务宿主（15 端点）         | PASS                  | PASS                     |
| apps/vscode              | 扩展视图层（零运行时依赖，CJS） | PASS（vsce 打包通过） | PASS（真实 VS Code 6/6） |

## 本阶段发现并修复的问题

1. **Windows 盘符大小写**：VS Code 将工作区 URI 规范化为小写盘符（`c:\`），与核心服务注册的 `C:\` 精确匹配失败 → 扩展判为未注册。修复：`fs.realpathSync.native` 还原真实大小写。
2. **扩展宿主内 process.execPath 是 VS Code 自身**：测试套件内 spawn 服务须用真实 node 路径（经环境变量显式传递）。
3. **`.vscode-test/`（1.1GB，test-electron 下载的 VS Code）未进 ignore 清单**：污染 git 状态并导致 ESLint OOM；已加入 .gitignore/.prettierignore/eslint ignores。

## 阻塞问题

无。

## 已知非阻塞事项

1. 本地目录名 `SumaryList`（会话占用无法改名；无功能影响）。
2. 扩展测试未接入 GitHub CI（需在 ubuntu 加 xvfb job；本轮以本地真实 VS Code 运行为准，接入留待阶段 6 CI 打磨）。
3. 阶段 2 顺延；项目命名风险（阶段 6 决策）。

## 进入下一阶段的条件

- [x] 阶段 4 验收标准满足（见阶段报告）
- [ ] 所有者确认阶段 4 验收；下达阶段 5（工程学习引擎）或阶段 2（MCP，经调整顺序）
