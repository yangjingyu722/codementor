# 项目状态

更新日期：2026-10-24 · 状态标记：PASS / FAIL / BLOCKED / NOT_RUN

## 当前阶段

**阶段 6：完整集成测试与开源发布准备 —— 复审整改完成（原判 FAIL：M1/M2；两项文档与治理修复已落地，待所有者复审转 PASS）**

### 复审记录（2026-10-24）

所有者复审判 FAIL，范围仅文档与治理（工程实质获公允确认）：

- **M1（已修复）**：五处用户文档的快速开始引用了文档步骤不会产出的 vsix。修复：README（英/中）、
  USER_GUIDE、DEMOS、RELEASE_NOTES、seed 脚本输出全部补 `pnpm package:vscode` 步骤
  （USER_GUIDE 显式注明 build 不产出 vsix）；新增 `tests/vsix.smoke.test.ts` 按文档路径
  真实执行 build → package → 校验 vsix 内容（含入口/图标条目），持续守护该路径。
- **M2（已修复）**：PRD §4 与 v0.1.0 交付范围（无 F2/F3）不一致。修复：PRD §4 增加
  "v0.1.0 交付范围裁定"（记录所有者的阶段顺序决策，F2/F3 顺延 v0.2、验收标准不变），
  §8 增加"发布闸门一致性"约束（对外口径与裁定一致 + 文档命令可复现性由冒烟测试守护）。
- 发布闸门保持所有者手中：v0.1.0 的 GitHub Release / Marketplace / 转公开仍未执行。

## 阶段完成情况

| 阶段/任务                  | 状态               | 说明                                                                                                                       |
| -------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 阶段 0/1/3/4/5             | PASS               | 已验收并推送（6 个 CI run 全绿）                                                                                           |
| 阶段 2（MCP）              | NOT_RUN            | 经所有者调整顺延；Agent 经核心服务 HTTP API 接入（本阶段的集成数据流即以该真实接入点驱动）                                 |
| 阶段 6：集成数据流（9 步） | PASS               | tests/e2e.full-flow.test.ts 5/5：需求→任务→声明→改码→变化分析→锚定→展示数据就绪→学习→持久化，全部真实实现执行              |
| 阶段 6：Demo A/B           | PASS               | demo/ 两个示例工程 + seed-demo.mjs（真实运行验证 2/2，含幂等）；Demo B 诚实边界（简化 C 模型、无 QEMU 声明）写入 README    |
| 阶段 6：质量审计（12 项）  | PASS               | docs/QUALITY_AUDIT.md——含"AI 事后编造理由"五层防线专项；依赖审计：zod 3→4 升级后 pnpm audit --prod = 0 漏洞                |
| 阶段 6：完整测试（10 项）  | PASS 7 / NOT_RUN 3 | 见 docs/TEST_REPORT.md 阶段 6 节；NOT_RUN：MCP 集成、Agent 真实联动（依赖阶段 2）、扩展测试 CI 化（本地真实 VS Code 已过） |
| 阶段 6：全新环境安装       | PASS               | 临时目录真实 clone → frozen install → build → 124/124（当时提交）                                                          |
| 阶段 6：开源交付           | PASS               | 双语 README、SECURITY.md、CHANGELOG.md、用户指南、Demo 指南、Release Notes 草稿（**未发布**）、vsix 重新打包               |
| 性能抽测                   | PASS               | 200 决策+学习会话写入 331ms；列表查询 7.6ms；单会话读取 0.41ms                                                             |

## 本阶段发现并修复的问题

1. **zod 高危漏洞（GHSA-mrhx-c7xc-m3w5）**：升级 zod 3→4（迁移仅 1 处 `z.record` 签名 + 2 处测试断言类型），生产依赖审计归零。
2. demo seed 脚本 `git()` 缺 return（真实 bug，脚本验证测试捕获）。
3. 测试相对路径 `../..` 语义陷阱（URL 相对文件路径含文件名段）。
4. **demo 目录误提交为 gitlink**：seed 脚本运行时创建的嵌套 .git 被 add 进索引，克隆方拿不到 demo 源文件（CI run 40079595598 真实暴露）；修复为普通文件入库 + 测试后清理运行时 .git（run 40079669874 全绿）。

## 阻塞问题

无。

## 待所有者决定（发布闸门）

1. **阶段 6 复审**：确认 M1/M2 整改后转 PASS。
2. **v0.1.0 发布**：Release Notes 草稿在 docs/RELEASE_NOTES_v0.1.0.md；**未经批准不发布** GitHub Release / VS Code Marketplace。
3. 可见性：仓库当前私有，转公开待批准。
4. 项目最终命名（codementor.io 相近风险，PRD §9）。

## 下一步

等待所有者最终审查。后续路线：阶段 2（MCP）→ 阶段 7 候选（TS 语言支持、扩展测试 CI 化、增量重验证）。
