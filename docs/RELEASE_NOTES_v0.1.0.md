# Release Notes — v0.1.0（草稿，未经所有者批准不发布）

**CodeMentor v0.1.0** — 让"AI 为什么这样写代码"成为可积累、可验证、可练习的工程资产。

> 发布状态：**待所有者批准**。本文件仅为 Release Notes 草稿；未经同意不会发布到
> GitHub Releases 或 VS Code Marketplace。

## 这是什么

CodeMentor 是嵌入 AI 编程工作流的工程认知学习系统。你继续用 AI Agent 写代码；
CodeMentor 把每个设计决策的"为什么"变成一等公民：编码前声明（时间戳背书）、
实现后锚定到真实代码行、并用它生成学习流程。

它**不是**执行日志查看器（回答不了"为什么/还考虑过什么"），**不是**代码解释器
（事后解释会被明确标注为 `rationalized`），**不是**云端服务（本地优先，零遥测）。

## 核心能力（v0.1.0）

1. **先声明，后实现**：决策在编码前经核心服务登记，`declaredAt` 由服务端时钟盖章；
   完整性规则保证"事后补写"无法伪装成"事前声明"（R1–R5）。
2. **认知来源分级**：每条设计理由标注 `declared / observed / rationalized`，
   UI 三区分离呈现——AI 的事后圆场永远不会被展示成原始设计意图。
3. **源码锚定**：决策锚定到 commit + 符号 + 行范围 + 内容哈希；代码漂移后符号优先
   重定位；无法定位时显式标记 ambiguous/missing，绝不静默错位。
4. **五步学习流程**：问题 → 方案判断 → 解释 → 代码验证 → 独立练习；三级渐进帮助；
   全部内容确定性生成自真实决策数据（无泛泛知识题）；进度跨会话恢复。
5. **本地优先**：18 个端点的本机服务（仅 127.0.0.1 + token）；SQLite 存储；
   VS Code 扩展零运行时依赖。

## 快速开始

见 [docs/USER_GUIDE.md](USER_GUIDE.md)。60 秒版本：

```bash
pnpm install && pnpm build
pnpm package:vscode                             # 打包扩展 vsix
pnpm --filter @codementor/server start          # 终端 1
code --install-extension apps/vscode/dist/codementor-0.1.0.vsix
node demo/seed-demo.mjs                          # 终端 2：装入两个示例工程
# 用 VS Code 打开 demo/demo-b-riscv-os → 侧栏 CodeMentor → 开始学习
```

## 质量与验证

- 131 项 Vitest（真实进程/文件/socket/git 仓库，无 Mock 冒充）+ 8 项真实 VS Code
  扩展测试；语句覆盖率 90.3%。
- `pnpm audit --prod`：0 已知漏洞。全链验证（build/typecheck/lint/format/test）
  在 Windows 本地与 GitHub CI（ubuntu + Node 20）双平台全绿。
- 完整审计：[docs/QUALITY_AUDIT.md](QUALITY_AUDIT.md)（含"AI 事后编造理由"专项防线清单）。

## 明确未实现（v0.1.0 边界）

- **MCP Agent 适配**：Agent 目前经核心服务 HTTP API 接入；MCP 封装顺延（阶段 2 计划）。
- **LLM 内容生成/评分**：学习内容为确定性模板；接口位已预留，LLM 评分永不作为事实。
- **TypeScript 源码解析**：v0.1 仅支持 C（`SourceParser` 抽象已就绪，可扩展）。
- **多用户/云同步/远端 API**：不在设计范围内。
- 扩展测试未接入 CI（本地真实 VS Code 已验证）。

## 已知问题

- 原生模块（better-sqlite3/tree-sitter）需匹配 Node 版本（版本精确钉住，见 ADR-0003/0005）。
- Windows 下强杀服务进程会残留 `server.json`（指向旧端口）；重启服务即可覆盖。
- 中文开放题的 rubric 评分偏严格（子串匹配）；反馈会列出全部真实要点引导重写。

## 升级与卸载

- 无升级路径（首个版本）。卸载：移除扩展 + 删除数据目录 `~/.codementor`。

## 致谢

tree-sitter 与 tree-sitter-c、better-sqlite3、Zod、VS Code Extension API 的作者与维护者。
