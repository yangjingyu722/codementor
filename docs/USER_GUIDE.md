# 用户使用指南（v0.1.0）

本指南面向想在本地体验 CodeMentor 的开发者。5 分钟内可完成：启动服务 → 装入示例工程 → 在 VS Code 中查看决策并完成一次学习。

## 1. 安装

### 1.1 前置要求

- Node.js ≥ 20（含 npm）
- pnpm 8（`npm i -g pnpm@8` 或启用 corepack：`corepack enable`）
- Git（源码映射需要）
- VS Code ≥ 1.90（用于扩展）

### 1.2 从源码安装（当前唯一方式）

```bash
git clone https://github.com/yangjingyu722/codementor.git
cd codementor
pnpm install
pnpm build
```

### 1.3 安装 VS Code 扩展

```bash
code --install-extension apps/vscode/dist/codementor-0.1.0.vsix
```

安装后活动栏出现 CodeMentor 图标。

## 2. 启动核心服务

```bash
pnpm --filter @codementor/server start
```

- 服务只监听 `127.0.0.1`，端口自动分配。
- 数据目录默认 `~/.codementor`（可用环境变量 `CODEMENTOR_HOME` 或扩展设置 `codementor.homeDir` 指定）。
- 启动后数据目录中出现 `server.json`（端口 + 鉴权 token，服务发现用）。
- 停止：`Ctrl+C`。数据保留在 `codementor.db`，重启自动恢复。

## 3. 装入示例工程（推荐从 Demo B 开始）

新开一个终端（保持服务运行）：

```bash
node demo/seed-demo.mjs
```

脚本会：初始化两个示例仓库的 git → 注册项目 → 创建任务与"编码前声明"的设计决策 → 锚定真实代码位置。成功输出：

```
✓ Demo A 数据就绪：1 任务 · 1 决策 · 1 锚点
✓ Demo B 数据就绪：1 任务 · 1 决策 · 2 锚点（PCB/状态/调度器/上下文切换）
```

也可以对**你自己的仓库**使用：让 Agent（或用 `curl`/脚本）调用核心服务 API 登记 `任务/决策/锚点`（端点见 `docs/LOCAL_API.md`）。

## 4. 在 VS Code 中使用

1. 用 VS Code 打开 `demo/demo-b-riscv-os` 文件夹（多根工作区取第一个文件夹）。
2. 若服务使用了非默认数据目录：设置里搜索 `codementor.homeDir` 填入同一路径。
3. 侧栏 **CodeMentor → 工程决策**：树形展示 Project → Task → Decision → Anchor，带状态图标（已声明/已实现/已验证；锚点已确认/无法精确定位/已失效）。
4. **查看决策**：点击决策 → 侧边打开详情页：
   - 工程问题、备选方案、最终选择；
   - 设计理由**按可信来源分三区**：事前声明（declared）/ 观察事实（observed，附证据）/ 事后推断（rationalized，明确标注不可视为原始意图）；
   - 关联代码可点击跳转。
5. **源码反向入口**：打开 `swtch.c` / `proc.c`，函数上方的 CodeLens "◆ 设计决策：…" 点击即可回到决策详情。
6. **开始学习**：详情页底部学习区 → "开始学习" →
   - 方案判断（选择题，提交后即时反馈）；
   - 代码验证（按提示定位真实符号，如 `swtch.c swtch`）；
   - 独立练习（用自己的话解释，按真实记录做确定性核对）；
   - 学习级别自动推荐（答错回到完整引导，答对升级独立练习），也可手动选择。
7. **代码变更后**：点击树视图标题栏的"重新验证锚点"——符号会自动重定位；无法定位时明确标记"已失效/无法精确定位"并显示最后已知位置（绝不静默错位）。

## 5. 常见问题

| 现象                     | 处理                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| 树显示"核心服务未连接"   | 确认服务已启动；检查 `codementor.homeDir` 与服务端 `CODEMENTOR_HOME` 是否一致 |
| 树显示"本工作区尚未注册" | 该文件夹还没有项目记录——运行 `demo/seed-demo.mjs` 或让 Agent 调 API 创建      |
| CodeLens 不出现          | 打开的是有锚点的文件（先完成锚定）；服务离线时 CodeLens 静默隐藏              |
| 扩展设置如何打开         | 命令面板 → "CodeMentor: 服务连接帮助" → "打开设置"                            |

## 6. 数据与隐私

- 所有数据（决策、主张、锚点、学习记录）都在本机 SQLite（`<CODEMENTOR_HOME>/codementor.db`）。
- 零遥测、零外部请求。安全模型见 [SECURITY.md](../SECURITY.md)。
